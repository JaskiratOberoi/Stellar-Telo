'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/auth/guards';
import { getMccScope } from '@/auth/scope';
import { getOrder } from '@/db/read/orders';
import { recordReceipt } from '@/db/sp/recordReceipt';
import { recordRefund } from '@/db/sp/recordRefund';
import { AppError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { PAY_METHODS } from '@/lib/payment-methods';

const schema = z.object({
  billId: z.coerce.number().int().positive(),
  method: z.enum(PAY_METHODS),
  amount: z.coerce.number().int().positive(),
});

export type RecordPaymentState = { error: string | null; ok: boolean };

/**
 * Record an OFFLINE payment (UPI/Card/Cash/Cheque/etc.) against an existing
 * bill. No gateway — the operator collected it; Telo books the receipt in its
 * own billing tables only (B2C). It does NOT post to the LIS client account —
 * that B2B ledger is settled manually. Scope-checked; the SP is idempotent
 * only on a gateway ref (none here), so the UI must avoid double-submit.
 */
export async function recordOfflinePayment(
  _prev: RecordPaymentState,
  formData: FormData,
): Promise<RecordPaymentState> {
  try {
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: 'Enter a valid amount and method.' };
    const { billId, method, amount } = parsed.data;

    const user = await requireCapability('payment:capture');
    const scope = await getMccScope(user.uid);
    const order = await getOrder(billId, scope); // scope-checked read
    if (!order) return { ok: false, error: 'Order not found in your scope.' };
    if (amount > order.balance) {
      return {
        ok: false,
        error: `Amount exceeds the outstanding balance (₹${order.balance}).`,
      };
    }

    const res = await recordReceipt({
      billId,
      amount,
      payMode: method,
      gatewayRef: null,
      userId: user.uid,
    });
    if (!res.ok) {
      return { ok: false, error: res.message || 'Could not record the payment.' };
    }

    audit({ kind: 'payment.recorded', billId, amount, ref: method });
    revalidatePath(`/orders/${billId}`);
    return { ok: true, error: null };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    return { ok: false, error: 'Something went wrong recording the payment.' };
  }
}

/**
 * Record a REFUND on an existing Telo bill. Reverses part of a payment:
 * decrements amount_paid, increments Balance, writes a marker receipt row.
 * Telo-internal only — does not touch the LIS client account.
 */
export async function recordRefundAction(
  _prev: RecordPaymentState,
  formData: FormData,
): Promise<RecordPaymentState> {
  try {
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { ok: false, error: 'Enter a valid amount and method.' };
    }
    const { billId, method, amount } = parsed.data;

    const user = await requireCapability('payment:capture');
    const scope = await getMccScope(user.uid);
    const order = await getOrder(billId, scope);
    if (!order) return { ok: false, error: 'Order not found in your scope.' };
    if (amount > order.amountPaid) {
      return {
        ok: false,
        error: `Refund exceeds the amount paid (₹${order.amountPaid}).`,
      };
    }

    const res = await recordRefund({
      billId,
      amount,
      payMode: method,
      reference: null,
      userId: user.uid,
    });
    if (!res.ok) {
      return { ok: false, error: res.message || 'Could not record the refund.' };
    }

    audit({ kind: 'payment.refunded', billId, amount, ref: method });
    revalidatePath(`/orders/${billId}`);
    return { ok: true, error: null };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    return { ok: false, error: 'Something went wrong recording the refund.' };
  }
}
