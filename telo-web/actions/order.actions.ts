'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { requireCapabilityForMcc } from '@/auth/guards';
import { getCart, clearCart } from '@/db/cartStore';
import { createOrder } from '@/db/sp/createOrder';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';

const patientSchema = z.object({
  vailid: z.string().trim().min(1).max(50),
  patientId: z.coerce.number().int().nonnegative().default(0),
  name: z.string().trim().min(1).max(200),
  age: z.coerce.number().int().min(0).max(150).optional(),
  gender: z.coerce.number().int().optional(), // 1/2 per Noble convention
  ageType: z.coerce.number().int().optional(),
  mobile: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(100).optional().or(z.literal('')),
  clinicalHistory: z.string().trim().max(500).optional(),
  discountAmount: z.coerce.number().int().min(0).default(0),
  paymentType: z.string().trim().max(50).optional(),
  payMode: z.coerce.number().int().optional(),
  receiptAmount: z.coerce.number().int().min(0).default(0),
});

export type PlaceOrderState = { error: string | null };

export async function placeOrder(
  _prev: PlaceOrderState,
  formData: FormData,
): Promise<PlaceOrderState> {
  let billId: number;
  try {
    const parsed = patientSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: 'Please check the patient details and try again.' };
    }
    const f = parsed.data;

    // We need the user + cart first to know the MCC for the scope check.
    const { currentUser } = await import('@/auth/session');
    const user = await currentUser();
    if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in required');

    const cart = await getCart(user.uid);
    if (cart.mccCode == null) {
      return { error: 'Select a collection centre before checking out.' };
    }
    if (cart.items.length === 0) {
      return { error: 'Your cart is empty.' };
    }

    // Capability + MCC scope (defence in depth — the SP re-validates too).
    await requireCapabilityForMcc('order:create', cart.mccCode);

    const result = await createOrder({
      userId: user.uid,
      mcc: cart.mccCode,
      // Legacy cart→checkout path doesn't collect per-sample-type SIDs (the
      // multi-SID model lives on /orders/new). The SP will return VALIDATION
      // when this is empty — by design, to push operators onto /orders/new.
      sampleSids: [],
      patientId: f.patientId,
      name: f.name,
      age: f.age ?? null,
      gender: f.gender ?? null,
      ageType: f.ageType ?? null,
      mobile: f.mobile || null,
      email: f.email || null,
      clinicalHistory: f.clinicalHistory || null,
      items: cart.items,
      discountAmount: f.discountAmount,
      payMode: f.payMode ?? null,
      // Legacy single-payment checkout → one payment line (if anything was
      // collected). The split-payment UI lives on /orders/new and /orders/b2b.
      payments:
        f.receiptAmount > 0
          ? [{ method: f.paymentType || 'Cash', amount: f.receiptAmount }]
          : [],
    });

    if (!result.ok || result.billId == null) {
      const msg =
        result.errorCode === 'CONFLICT'
          ? 'The order could not be placed due to a conflict. Please try again.'
          : result.message || 'Order could not be placed.';
      return { error: msg };
    }

    await clearCart(user.uid);
    audit({
      kind: 'order.placed',
      uid: user.uid,
      mcc: cart.mccCode,
      billId: result.billId,
      total: result.total,
    });
    billId = result.billId;
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    return { error: 'Something went wrong placing the order.' };
  }

  // Outside try/catch so the redirect isn't swallowed.
  redirect(`/orders/${billId}`);
}
