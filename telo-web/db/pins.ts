import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Per-user negative-balance pin preferences (dbo.telo_balance_pin_pref).
 *
 * Negative-balance bills are pinned to the top of the Accounts table by default.
 * This table records the EXCEPTIONS — bills a given Telo user has explicitly
 * unpinned. Presence of (user_id, bill_id) == "unpinned for this user"; absence
 * == pinned (the default). Keyed by user so colleagues sharing a client login
 * keep their own pin state. No LIS table is touched.
 */

/**
 * Returns the subset of `billIds` that the user has unpinned. Pass only the
 * negative-balance bill ids on the current page — the set is naturally small,
 * which keeps us well clear of the SQL parameter ceiling.
 */
export async function getUnpinnedBillIds(
  userId: number,
  billIds: number[],
): Promise<number[]> {
  const ids = billIds.filter((n) => Number.isInteger(n) && n > 0);
  if (!Number.isInteger(userId) || ids.length === 0) return [];
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request().input('uid', sql.Int, userId);
    const inClause = ids
      .map((id, i) => {
        req.input(`b${i}`, sql.Int, id);
        return `@b${i}`;
      })
      .join(',');
    const r = await req.query<{ bill_id: number }>(`
      SELECT bill_id
      FROM dbo.telo_balance_pin_pref
      WHERE user_id = @uid AND bill_id IN (${inClause})
    `);
    return r.recordset.map((x) => x.bill_id);
  });
}

/**
 * Set the pin state of a bill for a user. `pinned = true` (the default) removes
 * any unpin exception; `pinned = false` records one. Both branches are
 * idempotent so double-clicks are safe.
 */
export async function setBalancePin(
  userId: number,
  billId: number,
  pinned: boolean,
): Promise<void> {
  if (!Number.isInteger(userId) || !Number.isInteger(billId) || billId <= 0) {
    return;
  }
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool
      .request()
      .input('uid', sql.Int, userId)
      .input('bid', sql.Int, billId);
    if (pinned) {
      await req.query(
        `DELETE FROM dbo.telo_balance_pin_pref WHERE user_id = @uid AND bill_id = @bid`,
      );
    } else {
      await req.query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.telo_balance_pin_pref
          WHERE user_id = @uid AND bill_id = @bid
        )
          INSERT INTO dbo.telo_balance_pin_pref (user_id, bill_id)
          VALUES (@uid, @bid);
      `);
    }
  });
}
