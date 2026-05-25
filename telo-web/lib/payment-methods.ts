/**
 * Offline payment methods. Plain module (NOT 'use server') so it can be
 * imported by both server actions and client components — a 'use server'
 * file may only export async functions.
 *
 * Stored into the LIS free-text payment_type / pay_mode fields; paymode int
 * stays the LIS default (1).
 */
export const PAY_METHODS = [
  'Cash',
  'UPI',
  'Card',
  'Cheque',
  'Online',
  'Credit',
] as const;

export type PayMethod = (typeof PAY_METHODS)[number];
