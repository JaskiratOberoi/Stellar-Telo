import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * How many Telo-created patients already carry this mobile number. Drives the
 * live usage meter in the New Order form and the registerOrder pre-check;
 * dbo.usp_telo_create_order re-runs the same count inside the write path as
 * the authoritative gate (a race between two concurrent registrations is
 * therefore only advisory here, like the SID pre-check).
 *
 * Counts only Telo-originated rows (`addedby LIKE 'telo:%'`) — native LIS
 * patients never consume the allowance, matching "used in any Telo orders".
 * Exact match on the stored string (the form and registerOrder trim before
 * save, so stored values are already canonical).
 */
export async function countMobileUsage(mobile: string): Promise<number> {
  const v = mobile.trim();
  if (!v) return 0;
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('m', sql.VarChar(20), v)
      .query<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM dbo.tbl_med_mcc_patient_master
         WHERE mobile_number = @m AND addedby LIKE 'telo:%'`,
      );
    return r.recordset[0]?.n ?? 0;
  });
}
