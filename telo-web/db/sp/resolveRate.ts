import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export type RateSource = 'mrp' | 'special' | 'ratelist' | 'fallback' | 'none';

export interface ResolvedRate {
  rate: number | null;
  source: RateSource;
  rateTypeId: number | null;
}

/**
 * Calls dbo.usp_telo_resolve_rate for ONE catalog item. Telo bills at MRP
 * (catalogue list price), so the resolved rate is MCC-independent — the `mcc`
 * arg is retained for signature compatibility only. Pass either testMasterId
 * (test) or profileCode (profile). The price is the authoritative
 * server-resolved value — the client price is never trusted.
 */
export async function resolveRate(args: {
  mcc: number;
  testMasterId?: number | null;
  profileCode?: number | null;
  forBilling?: boolean;
}): Promise<ResolvedRate> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('mcc', sql.Int, args.mcc)
      .input('testMasterId', sql.Int, args.testMasterId ?? null)
      .input('profileCode', sql.Int, args.profileCode ?? null)
      .input('forBilling', sql.Bit, args.forBilling ? 1 : 0)
      .execute<{
        resolved_rate: number | null;
        source: RateSource;
        rate_type_id: number | null;
      }>('dbo.usp_telo_resolve_rate');
    const row = r.recordset[0];
    return {
      rate: row?.resolved_rate ?? null,
      source: row?.source ?? 'none',
      rateTypeId: row?.rate_type_id ?? null,
    };
  });
}
