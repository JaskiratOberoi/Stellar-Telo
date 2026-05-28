import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { loadCatalog } from '@/db/read/catalog';

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
 *
 * Prefer `resolveRatesBatch` for multi-item paths (cart, checkout, preview):
 * each call to this SP is one WAN round-trip to the India server, so N lines
 * = N RTTs. The batch variant does it in two parameterised IN-list lookups.
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

export interface ResolveItem {
  testMasterId?: number | null;
  profileCode?: number | null;
}

/**
 * Batched MRP lookup for many items at once. Mirrors usp_telo_resolve_rate's
 * logic (test → tbl_med_test_master.MRP, profile → tbl_med_test_profile_master.MRP)
 * with two key differences from the per-line variant:
 *
 *   1. Routes through `loadCatalog()` (Redis-cached 15 min). For the common
 *      case — items the user picked from the catalogue — this resolves all
 *      MRPs in one Redis GET, zero DB round-trips.
 *   2. Falls back to two parameterised IN-list SELECTs for anything missing
 *      from the catalogue cache (rare: ids that were active when picked but
 *      have since been deactivated, or hand-constructed inputs).
 *
 * Order of the returned array matches the input order; missing ids resolve
 * to { rate: null, source: 'none' }. Read-only against the LIS schema — no
 * writes, no DDL.
 */
export async function resolveRatesBatch(
  items: ResolveItem[],
): Promise<ResolvedRate[]> {
  if (items.length === 0) return [];

  // Build per-kind maps from the cached catalogue first.
  const testMap = new Map<number, number | null>();
  const profileMap = new Map<number, number | null>();
  try {
    const catalog = await loadCatalog();
    for (const c of catalog) {
      if (c.kind === 'test') testMap.set(c.id, c.mrp);
      else profileMap.set(c.id, c.mrp);
    }
  } catch {
    /* fall through to DB lookups for everything */
  }

  // Dedup ids and only DB-look-up what the catalogue didn't already answer.
  const missingTestIds = Array.from(
    new Set(
      items
        .map((i) => i.testMasterId)
        .filter(
          (n): n is number =>
            Number.isInteger(n) && (n as number) > 0 && !testMap.has(n as number),
        ),
    ),
  );
  const missingProfileIds = Array.from(
    new Set(
      items
        .map((i) => i.profileCode)
        .filter(
          (n): n is number =>
            Number.isInteger(n) && (n as number) > 0 && !profileMap.has(n as number),
        ),
    ),
  );

  if (missingTestIds.length > 0 || missingProfileIds.length > 0) {
    await withRetry(async () => {
      const pool = await getPool();

      if (missingTestIds.length > 0) {
        const req = pool.request();
        const params = missingTestIds
          .map((id, i) => {
            req.input(`t${i}`, sql.Int, id);
            return `@t${i}`;
          })
          .join(',');
        const r = await req.query<{ id: number; mrp: number | null }>(
          `SELECT id, MRP AS mrp FROM dbo.tbl_med_test_master WHERE id IN (${params})`,
        );
        for (const row of r.recordset) testMap.set(row.id, row.mrp);
      }

      if (missingProfileIds.length > 0) {
        const req = pool.request();
        const params = missingProfileIds
          .map((id, i) => {
            req.input(`p${i}`, sql.Int, id);
            return `@p${i}`;
          })
          .join(',');
        const r = await req.query<{ id: number; mrp: number | null }>(
          `SELECT id, MRP AS mrp FROM dbo.tbl_med_test_profile_master WHERE id IN (${params})`,
        );
        for (const row of r.recordset) profileMap.set(row.id, row.mrp);
      }
    });
  }

  return items.map((it) => {
    let mrp: number | null | undefined;
    if (it.testMasterId != null) mrp = testMap.get(it.testMasterId);
    else if (it.profileCode != null) mrp = profileMap.get(it.profileCode);
    const rate = mrp ?? null;
    return {
      rate,
      source: rate != null ? ('mrp' as const) : ('none' as const),
      rateTypeId: null,
    };
  });
}
