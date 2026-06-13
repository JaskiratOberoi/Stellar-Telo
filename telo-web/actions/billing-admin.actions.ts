'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireCapability, throttleAdminAction } from '@/auth/guards';
import { getMccScope } from '@/auth/scope';
import { getPool, sql, withRetry } from '@/db/pool';
import { setBillDiscount } from '@/db/sp/setBillDiscount';
import { voidReceipt } from '@/db/sp/voidReceipt';
import { cancelTest } from '@/db/sp/cancelTest';
import { recordMccPayment } from '@/db/sp/recordMccPayment';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';

/*
 * Super-admin-only billing/account mutations:
 *   - setBillDiscountAction:  change a bill's discount, recompute Balance.
 *   - voidReceiptAction:      void a recorded payment/refund txn.
 *   - cancelTestAction:       cancel a single test on the bill.
 *   - recordMccPaymentAction: post a manual client payment into the LIS
 *                             franchise-wallet ledger (Client Accounts screen).
 *
 * The bill mutations are gated by `user:manage`; the franchise-wallet payment by
 * `account:manage` — both super-admin-exclusive. All re-check MCC scope
 * server-side and are throttled. Bill mutations touch only Telo-origin bills
 * (the SPs also enforce this).
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

const cancelTestSchema = z.object({
  billId: z.coerce.number().int().positive(),
  lineId: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1).max(200),
});

/**
 * Cancels a single test on an existing bill. SUPER-ADMIN ONLY. Reason is
 * mandatory. Keeps the original line, adds a negative "(Cancelled)" offset line,
 * removes the ordered-test row and pulls the code from a still-registered SID —
 * see db/sql/84_usp_telo_cancel_test.sql. The SP refuses accessioned samples,
 * masters and split items; their message is surfaced to the operator.
 */
export async function cancelTestAction(
  _prev: BillingAdminState,
  formData: FormData,
): Promise<BillingAdminState> {
  try {
    const actor = await requireCapability('user:manage');
    await throttleAdminAction(actor.uid, 'test_cancel');

    const parsed = cancelTestSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('A reason is required to cancel a test.');
    const { billId, lineId, reason } = parsed.data;

    const mcc = await billMcc(billId);
    if (mcc == null) return err('Bill not found.');
    const scope = await getMccScope(actor.uid);
    if (!inScope(scope, mcc)) {
      return err('This bill is not in your assigned collection centres.');
    }

    const res = await cancelTest({ billId, lineId, actor: actor.uid, reason });
    if (!res.ok) return err(res.message ?? 'Could not cancel the test.');

    audit({ kind: 'bill.test.cancelled', actor: actor.uid, billId, lineId });
    revalidatePath(`/orders/${billId}`);
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong cancelling the test.');
  }
}

const mccPaymentSchema = z.object({
  mcc: z.coerce.number().int().positive(),
  amount: z.coerce.number().int().positive(),
  // deposittype: 1 DD · 2 Cheque · 3 Cash · 4 NEFT/Transfer · 5 Online · 6 Other
  mode: z.coerce.number().int().min(1).max(6),
  // Date-only ('YYYY-MM-DD'); blank → SP records "now". Bound as VarChar(10) and
  // CAST in SQL, matching the IST calendar-day handling in db/read/mccLedger.ts.
  depositDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
    .optional()
    .or(z.literal('')),
  chequeNo: z.string().trim().max(50).optional().default(''),
  reason: z.string().trim().max(200).optional().default(''),
});

/**
 * Records a MANUAL client payment (deposit toward Noble) into the shared LIS
 * franchise-wallet ledger from the Client Accounts screen. SUPER-ADMIN ONLY
 * (`account:manage`). Re-checks MCC scope, throttles and audits. Posts the same
 * tables the LIS Mcc_Account "Save" writes, so the balance reconciles in BOTH
 * portals — see db/sql/85_usp_telo_record_mcc_payment.sql.
 */
export async function recordMccPaymentAction(
  _prev: BillingAdminState,
  formData: FormData,
): Promise<BillingAdminState> {
  try {
    const actor = await requireCapability('account:manage');
    await throttleAdminAction(actor.uid, 'mcc_payment');

    const parsed = mccPaymentSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Please check the payment details and try again.');
    const { mcc, amount, mode, depositDate, chequeNo, reason } = parsed.data;

    const scope = await getMccScope(actor.uid);
    if (!inScope(scope, mcc)) {
      return err('This client is not in your assigned collection centres.');
    }

    const res = await recordMccPayment({
      mcc,
      actor: actor.uid,
      amount,
      mode,
      depositDate: depositDate || null,
      chequeNo: chequeNo || null,
      reason: reason || null,
    });
    if (!res.ok) return err(res.message ?? 'Could not record the payment.');

    audit({ kind: 'mcc.payment.recorded', actor: actor.uid, mcc, amount, mode });
    revalidatePath(`/client-accounts/${mcc}`);
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong recording the payment.');
  }
}
