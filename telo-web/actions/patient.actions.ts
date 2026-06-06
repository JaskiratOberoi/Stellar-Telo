'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireCapability, throttleAdminAction } from '@/auth/guards';
import { getMccScope } from '@/auth/scope';
import { getPool, sql, withRetry } from '@/db/pool';
import { updatePatientInfo } from '@/db/sp/updatePatient';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';

export interface PatientEditState {
  ok: boolean;
  error: string | null;
}

const ok = (): PatientEditState => ({ ok: true, error: null });
const err = (m: string): PatientEditState => ({ ok: false, error: m });

const schema = z.object({
  billId: z.coerce.number().int().positive(),
  patientName: z.string().trim().min(1).max(100),
  age: z.coerce.number().int().min(0).max(200),
  // 1 Years, 2 Months, 3 Days.
  ageType: z.coerce.number().int().min(1).max(3),
  // 1 Male, 2 Female (3 reserved for Other).
  gender: z.coerce.number().int().min(1).max(3),
  mobile: z.string().trim().max(20).optional().default(''),
  email: z.string().trim().max(100).optional().default(''),
});

/**
 * Corrects a bill's patient demographics. SUPER-ADMIN ONLY (gated by the
 * `user:manage` capability, which `auth/rbac.ts` grants to super_admin alone).
 * Never edits tests, SIDs, amounts, or payments. Updates both the bill and the
 * patient-master row (so the lab report / SID reflect the fix) via
 * dbo.usp_telo_update_patient_info.
 */
export async function updatePatientInfoAction(
  _prev: PatientEditState,
  formData: FormData,
): Promise<PatientEditState> {
  try {
    // user:manage is super-admin-exclusive — this is the super-admin gate.
    const actor = await requireCapability('user:manage');
    await throttleAdminAction(actor.uid, 'patient_edit');

    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return err('Please fill all required fields with valid values.');
    }
    const f = parsed.data;

    // Defence in depth: the bill's MCC must be in the caller's scope (a no-op
    // for unrestricted super admins, but guards URL-typed bill ids).
    const billMcc = await withRetry(async () => {
      const pool = await getPool();
      const r = await pool
        .request()
        .input('billId', sql.Int, f.billId)
        .query<{ mcc: number | null }>(
          `SELECT mcc_code AS mcc FROM dbo.tbl_billing_patient_detail WHERE id = @billId`,
        );
      return r.recordset[0]?.mcc ?? null;
    });
    if (billMcc == null) return err('Bill not found.');
    const scope = await getMccScope(actor.uid);
    if (scope.length > 0 && scope.length <= 1000 && !scope.includes(billMcc)) {
      return err('This bill is not in your assigned collection centres.');
    }

    const res = await updatePatientInfo({
      billId: f.billId,
      name: f.patientName,
      age: f.age,
      ageType: f.ageType,
      gender: f.gender,
      mobile: f.mobile ?? '',
      email: f.email ?? '',
      actor: actor.uid,
    });
    if (!res.ok) {
      return err(res.message ?? 'Could not update patient info.');
    }

    audit({ kind: 'patient.info.update', actor: actor.uid, billId: f.billId });
    revalidatePath(`/orders/${f.billId}`);
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong updating patient info.');
  }
}
