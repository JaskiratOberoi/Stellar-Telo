'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireCapability, throttleAdminAction } from '@/auth/guards';
import { getMccScope } from '@/auth/scope';
import { getPool, sql, withRetry } from '@/db/pool';
import { setBillDiscount } from '@/db/sp/setBillDiscount';
import { voidReceipt } from '@/db/sp/voidReceipt';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';

/*
 * Super-admin-only edits to an EXISTING bill from the order/receipt page:
 *   - setBillDiscountAction: change the discount, recompute Balance.
 *   - voidReceiptAction:     void a recorded payment/refund txn.
 *
 * Both are gated by the `user:manage` capability (super-admin-exclusive, same
 * gate as the patient-info editor), re-check MCC scope server-side, and are
 * throttled. They touch only Telo-origin bills (the SPs also enforce this).
 */

export interface BillingAdminState {
  ok: boolean;
  error: string | null;
}

const ok = (): BillingAdminState => ({ ok: true, error: null });
const err = (m: string): BillingAdminState => ({ ok: false, error: m });

/** Bill's MCC, used for the defence-in-depth scope check. Null = no such bill. */
async function billMcc(billId: number): Promise<number | null> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('billId', sql.Int, billId)
      .query<{ mcc: number | null }>(
        `SELECT mcc_code AS mcc FROM dbo.tbl_billing_patient_detail WHERE id = @billId`,
      );
    return r.recordset[0]?.mcc ?? null;
  });
}

/** Re-check that a bill's MCC is inside the caller's resolved scope. */
function inScope(scope: number[], mcc: number): boolean {
  // Unrestricted (Super Admin resolves to >1000 centres) → scope IN is a no-op.
  return scope.length > 1000 || scope.includes(mcc);
}

const discountSchema = z.object({
  billId: z.coerce.number().int().positive(),
  discount: z.coerce.number().int().min(0),
});

/**
 * Sets the discount on an existing bill. SUPER-ADMIN ONLY. Over-discount is
 * permitted (Balance may go negative, signalling a refund is due) — see
 * db/sql/82_usp_telo_set_bill_discount.sql.
 */
export async function setBillDiscountAction(
  _prev: BillingAdminState,
  formData: FormData,
): Promise<BillingAdminState> {
  try {
    const actor = await requireCapability('user:manage');
    await throttleAdminAction(actor.uid, 'bill_discount');

    const parsed = discountSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Enter a valid discount amount.');
    const { billId, discount } = parsed.data;

    const mcc = await billMcc(billId);
    if (mcc == null) return err('Bill not found.');
    const scope = await getMccScope(actor.uid);
    if (!inScope(scope, mcc)) {
      return err('This bill is not in your assigned collection centres.');
    }

    const res = await setBillDiscount({ billId, discount, actor: actor.uid });
    if (!res.ok) return err(res.message ?? 'Could not update the discount.');

    audit({ kind: 'bill.discount.set', actor: actor.uid, billId, discount });
    revalidatePath(`/orders/${billId}`);
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong updating the discount.');
  }
}

const voidSchema = z.object({
  billId: z.coerce.number().int().positive(),
  receiptId: z.coerce.number().int().positive(),
  reason: z.string().trim().max(200).optional().default(''),
});

/**
 * Voids a single payment/refund receipt on an existing bill. SUPER-ADMIN ONLY.
 * The receipt row is kept for the audit trail; its effect on the bill's
 * amount_paid / Balance is reversed — see db/sql/83_usp_telo_void_receipt.sql.
 */
export async function voidReceiptAction(
  _prev: BillingAdminState,
  formData: FormData,
): Promise<BillingAdminState> {
  try {
    const actor = await requireCapability('user:manage');
    await throttleAdminAction(actor.uid, 'receipt_void');

    const parsed = voidSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Invalid request.');
    const { billId, receiptId, reason } = parsed.data;

    const mcc = await billMcc(billId);
    if (mcc == null) return err('Bill not found.');
    const scope = await getMccScope(actor.uid);
    if (!inScope(scope, mcc)) {
      return err('This bill is not in your assigned collection centres.');
    }

    const res = await voidReceipt({
      receiptId,
      billId,
      actor: actor.uid,
      reason: reason || null,
    });
    if (!res.ok) return err(res.message ?? 'Could not void the transaction.');

    audit({ kind: 'receipt.voided', actor: actor.uid, billId, receiptId });
    revalidatePath(`/orders/${billId}`);
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong voiding the transaction.');
  }
}
