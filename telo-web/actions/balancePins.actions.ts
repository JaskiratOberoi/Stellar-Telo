'use server';

import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { setBalancePin } from '@/db/pins';

/**
 * Pin (or unpin) a negative-balance bill to the top of the caller's Accounts
 * table. The preference is per Telo user — colleagues sharing a client login are
 * unaffected. Purely a view-ordering preference (no LIS data is changed).
 */
export async function toggleBalancePin(
  billId: number,
  pinned: boolean,
): Promise<{ ok: boolean }> {
  const user = await currentUser();
  if (!user || !hasCapability(user.caps, 'balance:view')) {
    return { ok: false };
  }
  if (!Number.isInteger(billId) || billId <= 0) {
    return { ok: false };
  }
  await setBalancePin(user.uid, billId, pinned);
  return { ok: true };
}
