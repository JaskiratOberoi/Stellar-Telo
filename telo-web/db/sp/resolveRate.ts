import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export type RateSource = 'mrp' | 'special' | 'ratelist' | 'fallback' | 'none';

export interface ResolvedRate {
  rate: number | null;
  source: RateSource;
  rateTypeId: number | null;
}

/**
 * Calls dbo.usp_telo_resolve_rate for ONE catalog item. MCC-aware and
 * special-rate-aware, exactly mirroring the LIS billing path: a per-MCC
 * special rate (tbl_med_mcc_test_special_rates) outranks the assigned rate
 * list, which outranks catalogue MRP. Pass EXACTLY ONE of testMasterId
 * (test), profileCode (profile), or masterCode (master profile). The price is
 * the authoritative server-resolved value — the client price is never trusted.
 *
 * Prefer `resolveRatesBatch` for multi-item paths (cart, checkout, preview):
 * each call to this SP is one WAN round-trip to the India server, so N lines
 * = N RTTs. The batch variant does it in a handful of parameterised IN-lists.
 */
export async function resolveRate(args: {
  mcc: number;
  testMasterId?: number | null;
  profileCode?: number | null;
  masterCode?: number | null;
  forBilling?: boolean;
}): Promise<ResolvedRate> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('mcc', sql.Int, args.mcc)
      .input('testMasterId', sql.Int, args.testMasterId ?? null)
      .input('profileCode', sql.Int, args.profileCode ?? null)
      .input('masterCode', sql.Int, args.masterCode ?? null)
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
  masterCode?: number | null;
}

/**
 * Batched, MCC-aware rate resolution for many items at once. Mirrors
 * usp_telo_resolve_rate's tiered logic so the previewed price always equals
 * the billed price:
 *
 *   tier 0 (special) : the item's per-MCC special rate
 *                      (tbl_med_mcc_test_special_rates) — the LIS billing path
 *                      always prefers this over the rate list, so Telo must too
 *                      or the preview/floor-check/bill would disagree.
 *   tier 1 (ratelist): the item's Price in the rate list assigned to the MCC
 *                      (tbl_med_mcc_unit_master.RateType). Read LIVE from the
 *                      rate tables so an updated LIS rate list shows up in
 *                      Telo immediately — no cache, no re-sync step.
 *   tier 2 (mrp)     : catalogue MRP when the item isn't in the rate list, or
 *                      the MCC has no rate list assigned. Read LIVE for exactly
 *                      the ids being priced so an LIS MRP edit bills at once.
 *
 * Handles all three kinds: test (testMasterId), profile (profileCode), and
 * master profile (masterCode). Performance: a handful of round-trips total
 * regardless of item count — 1 for the MCC RateType, 1 for special rates, one
 * IN-list per kind for rate-list prices, and one IN-list per kind for the live
 * MRP fallback. No per-line fan-out.
 *
 * `mccId` null (or an MCC with no RateType) => special/MRP only. Order of the
 * returned array matches the input order; missing ids resolve to
 * { rate: null, source: 'none' }. Read-only — no writes, no DDL.
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
  const masterMrp = new Map<number, number | null>();

  const uniq = (xs: (number | null | undefined)[]) =>
    Array.from(
      new Set(
        xs.filter((n): n is number => Number.isInteger(n) && (n as number) > 0),
      ),
    );
  const testIds = uniq(items.map((i) => i.testMasterId));
  const profileIds = uniq(items.map((i) => i.profileCode));
  const masterIds = uniq(items.map((i) => i.masterCode));

  // ── Live rate-list + special prices ─────────────────────────────────
  const testRate = new Map<number, number>();
  const profileRate = new Map<number, number>();
  const masterRate = new Map<number, number>();
  const specialTest = new Map<number, number>();
  const specialProfile = new Map<number, number>();
  const specialMaster = new Map<number, number>();
  let rateTypeId: number | null = null;

  // Helper: build a parameterised IN-list on a fresh request.
  const inList = (
    req: ReturnType<Awaited<ReturnType<typeof getPool>>['request']>,
    prefix: string,
    ids: number[],
  ) =>
    ids
      .map((id, i) => {
        req.input(`${prefix}${i}`, sql.Int, id);
        return `@${prefix}${i}`;
      })
      .join(',');

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

      // tier 0: per-MCC special rates (one query for all kinds)
      const anyIds = testIds.length + profileIds.length + masterIds.length;
      if (anyIds > 0) {
        const req = pool.request().input('mcc', sql.Int, mccId);
        const clauses: string[] = [];
        if (testIds.length)
          clauses.push(`(testtype = 'T' AND testid IN (${inList(req, 'st', testIds)}))`);
        if (profileIds.length)
          clauses.push(`(testtype = 'P' AND testid IN (${inList(req, 'sp', profileIds)}))`);
        if (masterIds.length)
          clauses.push(`(testtype = 'M' AND testid IN (${inList(req, 'sm', masterIds)}))`);
        const r = await req.query<{ testtype: string; testid: number; rate: number }>(
          `SELECT testtype, testid, rate FROM dbo.tbl_med_mcc_test_special_rates
           WHERE mcccode = @mcc AND (${clauses.join(' OR ')})`,
        );
        for (const row of r.recordset) {
          if (row.testtype === 'T') specialTest.set(row.testid, row.rate);
          else if (row.testtype === 'P') specialProfile.set(row.testid, row.rate);
          else if (row.testtype === 'M') specialMaster.set(row.testid, row.rate);
        }
      }
    }

    if (rateTypeId != null && testIds.length > 0) {
      const req = pool.request().input('rt', sql.Int, rateTypeId);
      const params = inList(req, 't', testIds);
      const r = await req.query<{ TestCode: number; Price: number }>(
        `SELECT TestCode, Price FROM dbo.tbl_med_test_rates_with_pcc_type
         WHERE RateTypeId = @rt AND IsActive = 1 AND TestCode IN (${params})`,
      );
      for (const row of r.recordset) testRate.set(row.TestCode, row.Price);
    }

    if (rateTypeId != null && profileIds.length > 0) {
      const req = pool.request().input('rt', sql.Int, rateTypeId);
      const params = inList(req, 'p', profileIds);
      const r = await req.query<{ profilecode: number; Price: number }>(
        `SELECT profilecode, Price FROM dbo.tbl_med_profile_rates_with_pcc_types
         WHERE RateTypeId = @rt AND IsActive = 1 AND profilecode IN (${params})`,
      );
      for (const row of r.recordset) profileRate.set(row.profilecode, row.Price);
    }

    if (rateTypeId != null && masterIds.length > 0) {
      const req = pool.request().input('rt', sql.Int, rateTypeId);
      const params = inList(req, 'm', masterIds);
      const r = await req.query<{ master_profile_code: number; Price: number }>(
        `SELECT master_profile_code, Price FROM dbo.tbl_med_master_profile_rates_with_pcc_types
         WHERE RateTypeId = @rt AND IsActive = 1 AND master_profile_code IN (${params})`,
      );
      for (const row of r.recordset) masterRate.set(row.master_profile_code, row.Price);
    }

    // ── Live MRP for every item being priced (real-time, all kinds) ───
    if (testIds.length > 0) {
      const req = pool.request();
      const params = inList(req, 'mt', testIds);
      const r = await req.query<{ id: number; mrp: number | null }>(
        `SELECT id, MRP AS mrp FROM dbo.tbl_med_test_master WHERE id IN (${params})`,
      );
      for (const row of r.recordset) testMrp.set(row.id, row.mrp);
    }

    if (profileIds.length > 0) {
      const req = pool.request();
      const params = inList(req, 'mp', profileIds);
      const r = await req.query<{ id: number; mrp: number | null }>(
        `SELECT id, MRP AS mrp FROM dbo.tbl_med_test_profile_master WHERE id IN (${params})`,
      );
      for (const row of r.recordset) profileMrp.set(row.id, row.mrp);
    }

    if (masterIds.length > 0) {
      const req = pool.request();
      const params = inList(req, 'mm', masterIds);
      const r = await req.query<{ id: number; mrp: number | null }>(
        `SELECT id, MRP AS mrp FROM dbo.tbl_med_test_master_profile_master WHERE id IN (${params})`,
      );
      for (const row of r.recordset) masterMrp.set(row.id, row.mrp);
    }
  });

  // ── Assemble: special → rate-list → MRP fallback ────────────────────
  return items.map((it) => {
    if (it.testMasterId != null) {
      const sp = specialTest.get(it.testMasterId);
      if (sp != null) return { rate: sp, source: 'special', rateTypeId: null };
      const rl = testRate.get(it.testMasterId);
      if (rl != null) return { rate: rl, source: 'ratelist', rateTypeId };
      const mrp = testMrp.get(it.testMasterId) ?? null;
      return { rate: mrp, source: mrp != null ? 'mrp' : 'none', rateTypeId: null };
    }
    if (it.profileCode != null) {
      const sp = specialProfile.get(it.profileCode);
      if (sp != null) return { rate: sp, source: 'special', rateTypeId: null };
      const rl = profileRate.get(it.profileCode);
      if (rl != null) return { rate: rl, source: 'ratelist', rateTypeId };
      const mrp = profileMrp.get(it.profileCode) ?? null;
      return { rate: mrp, source: mrp != null ? 'mrp' : 'none', rateTypeId: null };
    }
    if (it.masterCode != null) {
      const sp = specialMaster.get(it.masterCode);
      if (sp != null) return { rate: sp, source: 'special', rateTypeId: null };
      const rl = masterRate.get(it.masterCode);
      if (rl != null) return { rate: rl, source: 'ratelist', rateTypeId };
      const mrp = masterMrp.get(it.masterCode) ?? null;
      return { rate: mrp, source: mrp != null ? 'mrp' : 'none', rateTypeId: null };
    }
    return { rate: null, source: 'none', rateTypeId: null };
  });
}
