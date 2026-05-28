/**
 * Offline payment methods. Plain module (NOT 'use server') so it can be
 * imported by both server actions and client components — a 'use server'
 * file may only export async functions.
 *
 * Stored into the LIS free-text payment_type / pay_mode fields; paymode int
 * stays the LIS default (1).
 */
// NOTE: 'Credit' is intentionally OMITTED for now (stakeholder request).
// Historical receipts that already booked as 'Credit' in the LIS render
// fine — only the new-payment dropdown + server-side Zod enum exclude it.
// Re-add the literal here when credit accounting is ready.
export const PAY_METHODS = [
  'Cash',
  'UPI',
  'Card',
  'Cheque',
  'Online',
] as const;

export type PayMethod = (typeof PAY_METHODS)[number];
