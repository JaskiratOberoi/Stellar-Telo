import 'server-only';
import { cached, redis } from '@/lib/cache';
import { fetchUserMccScope, fetchUserReportMccScope } from '@/db/read/userScope';
import { AppError } from '@/lib/errors';

/** Cache key for one user's MCC scope set. Kept in one place so the
 * invalidator can't drift from the reader. */
function scopeKey(userId: number): string {
  return `telo:scope:${userId}`;
}

/** Cache key for one user's REPORT MCC scope set (assigned mappings ∪ own
 * centre, regardless of usertype). Distinct from the ordering scope above. */
function reportScopeKey(userId: number): string {
  return `telo:reportscope:${userId}`;
}

/**
 * Per-user allowed MCC code set, redis-cached (10k+ global mapping rows are
 * never put in the JWT). Cache miss/Redis-down degrades to a live query.
 */
export async function getMccScope(userId: number): Promise<number[]> {
  return cached(scopeKey(userId), 300, () => fetchUserMccScope(userId));
}

/**
 * Per-user REPORT MCC scope, redis-cached. Honours admin-assigned sales-mcc
 * mappings for every usertype (see fetchUserReportMccScope) — the ordering
 * scope above intentionally does not. Busted by invalidateMccScope alongside
 * the ordering key so admin scope edits take effect immediately.
 */
export async function getReportMccScope(userId: number): Promise<number[]> {
  return cached(reportScopeKey(userId), 300, () =>
    fetchUserReportMccScope(userId),
  );
}

/**
 * Bust the cached MCC scope for one user. Call after ANY admin write that
 * changes `tbl_med_user_sales_mcc_mapping` rows for that user — without this
 * the next 5 minutes of `assertMccInScope()` checks see stale data, which is
 * both a UX bug (admin changes appear not to take effect) and a security bug
 * (a newly-removed centre can still be acted on, or a newly-added one stays
 * "out of scope"). Best-effort: Redis-down is silently swallowed because the
 * cache will simply expire on its own TTL.
 */
export async function invalidateMccScope(userId: number): Promise<void> {
  if (!Number.isInteger(userId)) return;
  try {
    await redis().del(scopeKey(userId), reportScopeKey(userId));
  } catch {
    /* best-effort */
  }
}

/**
 * The user's OWN collection centre id(s) — their PCC_Id / sub_pcc_id. Passed to
 * fetchScopedMccUnits so a user's own centre is shown even when the LIS flags
 * the unit inactive (it never affects which centres are *in scope*, only
 * whether an in-scope own centre is hidden by the inactive filter).
 */
export function ownCentreIds(user: {
  pccId: number | null;
  subPccId: number | null;
}): number[] {
  return [user.pccId, user.subPccId].filter(
    (n): n is number => typeof n === 'number' && n > 0,
  );
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
