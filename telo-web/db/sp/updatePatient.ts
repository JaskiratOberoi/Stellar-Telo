import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface UpdatePatientResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
}

/**
 * Corrects a bill's patient demographics (name/age/age_type/gender/mobile/email)
 * across both the bill and the patient-master row, via
 * dbo.usp_telo_update_patient_info. Telo-origin bills only (the proc refuses
 * others). Caller must already be authorised (super admin) — see
 * actions/patient.actions.ts.
 */
export async function updatePatientInfo(args: {
  billId: number;
  name: string;
  age: number;
  ageType: number;
  gender: number;
  mobile: string;
  email: string;
  actor: number;
}): Promise<UpdatePatientResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('billId', sql.Int, args.billId)
      .input('name', sql.NVarChar(100), args.name)
      .input('age', sql.Int, args.age)
      .input('ageType', sql.Int, args.ageType)
      .input('gender', sql.Int, args.gender)
      .input('mobile', sql.NVarChar(20), args.mobile ?? '')
      .input('email', sql.NVarChar(100), args.email ?? '')
      .input('userId', sql.Int, args.actor)
      .execute<{ ok: boolean; error_code: string | null; message: string | null }>(
        'dbo.usp_telo_update_patient_info',
      );
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
    };
  });
}
