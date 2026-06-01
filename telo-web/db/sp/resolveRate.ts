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
 * Batched, MCC-aware rate resolution for many items at once. Mirrors
 * usp_telo_resolve_rate's two-tier logic so the previewed price always equals
 * the billed price:
 *
 *   tier 1 (ratelist): the item's Price in the rate list assigned to the MCC
 *                      (tbl_med_mcc_unit_master.RateType). Read LIVE from the
 *                      rate tables so an updated LIS rate list shows up in
 *                      Telo immediately — no cache, no re-sync step.
 *   tier 2 (mrp)     : catalogue MRP when the item isn't in the rate list, or
 *                      the MCC has no rate list assigned. MRP comes from the
 *                      Redis-cached catalogue (15 min) — fine for a fallback.
 *
 * Performance: at most ~3 round-trips total regardless of item count —
 *   1 to read the MCC's RateType, 1 IN-list for test rate-list prices,
 *   1 IN-list for profile rate-list prices (+ MRP-fallback IN-lists only for
 *   ids the cached catalogue didn't answer). No per-line fan-out.
 *
 * `mccId` null (or an MCC with no RateType) => MRP-only (legacy behaviour).
 * Order of the returned array matches the input order; missing ids resolve
 * to { rate: null, source: 'none' }. Read-only — no writes, no DDL.
 */
export async function resolveRatesBatch(
  mccId: number | null,
  items: ResolveItem[],
): Promise<ResolvedRate[]> {
  if (items.length === 0) return [];

  // MRP fallback maps — filled LIVE below for exactly the items being priced,
  // so an MRP edited in the LIS during the day bills immediately (no cached-
  // catalogue lag). Only the cart's handful of ids are queried, not the whole
  // catalogue, so this is cheaper than the previous full-catalogue prefill.
  const testMrp = new Map<number, number | null>();
  const profileMrp = new Map<number, number | null>();

  const uniq = (xs: (number | null | undefined)[]) =>
    Array.from(
      new Set(
        xs.filter((n): n is number => Number.isInteger(n) && (n as number) > 0),
      ),
    );
  const testIds = uniq(items.map((i) => i.testMasterId));
  const profileIds = uniq(items.map((i) => i.profileCode));

  // ── Live rate-list prices for the MCC's assigned RateType ───────────
  const testRate = new Map<number, number>();
  const profileRate = new Map<number, number>();
  let rateTypeId: number | null = null;

  await withRetry(async () => {
    const pool = await getPool();

    if (mccId != null) {
      const rt = await pool
        .request()
        .input('mcc', sql.Int, mccId)
        .query<{ RateType: number | null }>(
          `SELECT RateType FROM dbo.tbl_med_mcc_unit_master WHERE id = @mcc`,
        );
      rateTypeId = rt.recordset[0]?.RateType ?? null;
    }

    if (rateTypeId != null && testIds.length > 0) {
      const req = pool.request().input('rt', sql.Int, rateTypeId);
      const params = testIds
        .map((id, i) => {
          req.input(`t${i}`, sql.Int, id);
          return `@t${i}`;
        })
        .join(',');
      const r = await req.query<{ TestCode: number; Price: number }>(
        `SELECT TestCode, Price FROM dbo.tbl_med_test_rates_with_pcc_type
         WHERE RateTypeId = @rt AND IsActive = 1 AND TestCode IN (${params})`,
      );
      for (const row of r.recordset) testRate.set(row.TestCode, row.Price);
    }

    if (rateTypeId != null && profileIds.length > 0) {
      const req = pool.request().input('rt', sql.Int, rateTypeId);
      const params = profileIds
        .map((id, i) => {
          req.input(`p${i}`, sql.Int, id);
          return `@p${i}`;
        })
        .join(',');
      const r = await req.query<{ profilecode: number; Price: number }>(
        `SELECT profilecode, Price FROM dbo.tbl_med_profile_rates_with_pcc_types
         WHERE RateTypeId = @rt AND IsActive = 1 AND profilecode IN (${params})`,
      );
      for (const row of r.recordset) profileRate.set(row.profilecode, row.Price);
    }

    // ── Live MRP fallback for every item being priced (real-time) ─────
    if (testIds.length > 0) {
      const req = pool.request();
      const params = testIds
        .map((id, i) => {
          req.input(`mt${i}`, sql.Int, id);
          return `@mt${i}`;
        })
        .join(',');
      const r = await req.query<{ id: number; mrp: number | null }>(
        `SELECT id, MRP AS mrp FROM dbo.tbl_med_test_master WHERE id IN (${params})`,
      );
      for (const row of r.recordset) testMrp.set(row.id, row.mrp);
    }

    if (profileIds.length > 0) {
      const req = pool.request();
      const params = profileIds
        .map((id, i) => {
          req.input(`mp${i}`, sql.Int, id);
          return `@mp${i}`;
        })
        .join(',');
      const r = await req.query<{ id: number; mrp: number | null }>(
        `SELECT id, MRP AS mrp FROM dbo.tbl_med_test_profile_master WHERE id IN (${params})`,
      );
      for (const row of r.recordset) profileMrp.set(row.id, row.mrp);
    }
  });

  // ── Assemble: rate-list price first, else MRP fallback ──────────────
  return items.map((it) => {
    if (it.testMasterId != null) {
      const rl = testRate.get(it.testMasterId);
      if (rl != null) return { rate: rl, source: 'ratelist', rateTypeId };
      const mrp = testMrp.get(it.testMasterId) ?? null;
      return { rate: mrp, source: mrp != null ? 'mrp' : 'none', rateTypeId: null };
    }
    if (it.profileCode != null) {
      const rl = profileRate.get(it.profileCode);
      if (rl != null) return { rate: rl, source: 'ratelist', rateTypeId };
      const mrp = profileMrp.get(it.profileCode) ?? null;
      return { rate: mrp, source: mrp != null ? 'mrp' : 'none', rateTypeId: null };
    }
    return { rate: null, source: 'none', rateTypeId: null };
  });
}
