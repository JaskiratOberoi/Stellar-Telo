import 'server-only';
import { cached } from '@/lib/cache';
import { fetchUserMccScope } from '@/db/read/userScope';
import { AppError } from '@/lib/errors';

/**
 * Per-user allowed MCC code set, redis-cached (10k+ global mapping rows are
 * never put in the JWT). Cache miss/Redis-down degrades to a live query.
 */
export async function getMccScope(userId: number): Promise<number[]> {
  return cached(`telo:scope:${userId}`, 300, () => fetchUserMccScope(userId));
}

/**
 * Defence-in-depth gate. Every order/bill mutation calls this before invoking
 * the write SP (the SP also re-validates server-side).
 */
export async function assertMccInScope(
  userId: number,
  mccCode: number,
): Promise<void> {
  const scope = await getMccScope(userId);
  if (!scope.includes(mccCode)) {
    throw new AppError(
      'OUT_OF_SCOPE',
      `MCC ${mccCode} is not in your assigned collection centres`,
    );
  }
}
