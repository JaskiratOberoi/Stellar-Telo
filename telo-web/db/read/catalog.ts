import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { cached } from '@/lib/cache';
import type {
  CatalogItem,
  CatalogKind,
  CatalogItemPriced,
} from '@/domain/catalog/catalog.types';

/**
 * Active test + profile + master-profile catalog. Listec does not expose the
 * test catalog, so this uses Telo's own pool with parameterised SELECTs. The
 * full active set (~1.5k tests + ~130 profiles + a few master profiles) is
 * small — load once, filter/search in memory (P2). Master profiles (e.g. JK
 * HEALTH SCREEN) are bundles of profiles + tests, orderable as a single line.
 *
 * Only powers the New Order test-search typeahead now (structure + an
 * indicative MRP). The catalog price *view* and order/cart billing read prices
 * live, so this short cache only affects that advisory MRP — kept at 60s so an
 * intraday MRP edit surfaces within a minute without a per-keystroke DB scan.
 */
async function loadCatalogUncached(): Promise<CatalogItem[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool.request().query<{
      id: number;
      kind: string;
      code: string;
      name: string;
      departmentId: number | null;
      mrp: number | null;
      costCt: number | null;
    }>(`
      SELECT id, 'test' AS kind, TestCode AS code, Testname AS name,
             DepartmentId AS departmentId, MRP AS mrp, Price_CT AS costCt
      FROM dbo.tbl_med_test_master
      WHERE IsActive = 1
      UNION ALL
      SELECT id, 'profile' AS kind, Profile_Code AS code, Profile_Name AS name,
             department_id AS departmentId, MRP AS mrp, CT AS costCt
      FROM dbo.tbl_med_test_profile_master
      WHERE IsActive = 1
      UNION ALL
      SELECT id, 'master' AS kind, Master_Profile_Code AS code,
             Master_Profile_Name AS name,
             NULL AS departmentId, MRP AS mrp, CT AS costCt
      FROM dbo.tbl_med_test_master_profile_master
      WHERE IsActive = 1
      ORDER BY name
    `);
    return r.recordset.map((x) => ({
      id: x.id,
      kind: (x.kind === 'profile'
        ? 'profile'
        : x.kind === 'master'
          ? 'master'
          : 'test') as CatalogKind,
      code: (x.code ?? '').trim(),
      name: (x.name ?? '').trim(),
      departmentId: x.departmentId ?? null,
      mrp: x.mrp ?? null,
      costCt: x.costCt ?? null,
    }));
  });
}

export async function loadCatalog(): Promise<CatalogItem[]> {
  // v2 key: the cached shape now includes master-profile rows. 60s TTL keeps
  // the typeahead's advisory MRP fresh without a per-keystroke DB scan.
  return cached('telo:catalog:v2', 60, loadCatalogUncached);
}

/**
 * The full rate-list price map for one RateType. Read LIVE (not cached) so a
 * rate-list edit made in the LIS during the day shows up in the catalog
 * immediately — there's no re-sync step. One query pair per catalog page view
 * (low-traffic, internal); rates are indexed by RateTypeId.
 */
async function loadRateMapsForType(
  rateTypeId: number,
): Promise<{
  tests: [number, number][];
  profiles: [number, number][];
  masters: [number, number][];
}> {
  return withRetry(async () => {
    const pool = await getPool();
    const tr = await pool
      .request()
      .input('rt', sql.Int, rateTypeId)
      .query<{ TestCode: number; Price: number }>(
        `SELECT TestCode, Price FROM dbo.tbl_med_test_rates_with_pcc_type
         WHERE RateTypeId = @rt AND IsActive = 1`,
      );
    const pr = await pool
      .request()
      .input('rt', sql.Int, rateTypeId)
      .query<{ profilecode: number; Price: number }>(
        `SELECT profilecode, Price FROM dbo.tbl_med_profile_rates_with_pcc_types
         WHERE RateTypeId = @rt AND IsActive = 1`,
      );
    const mr = await pool
      .request()
      .input('rt', sql.Int, rateTypeId)
      .query<{ master_profile_code: number; Price: number }>(
        `SELECT master_profile_code, Price FROM dbo.tbl_med_master_profile_rates_with_pcc_types
         WHERE RateTypeId = @rt AND IsActive = 1`,
      );
    return {
      tests: tr.recordset.map((r) => [r.TestCode, r.Price] as [number, number]),
      profiles: pr.recordset.map(
        (r) => [r.profilecode, r.Price] as [number, number],
      ),
      masters: mr.recordset.map(
        (r) => [r.master_profile_code, r.Price] as [number, number],
      ),
    };
  });
}

/**
 * Per-MCC special rates (tbl_med_mcc_test_special_rates), keyed by MCC. These
 * outrank the rate list exactly as the LIS billing path does, so the catalog
 * price the operator sees equals what gets billed. Read LIVE (uncached) so a
 * special-rate edit in the LIS surfaces on the next catalog view — no lag.
 */
async function loadSpecialRatesForMcc(
  mccId: number,
): Promise<{
  tests: [number, number][];
  profiles: [number, number][];
  masters: [number, number][];
}> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('mcc', sql.Int, mccId)
      .query<{ testtype: string; testid: number; rate: number }>(
        `SELECT testtype, testid, rate FROM dbo.tbl_med_mcc_test_special_rates
         WHERE mcccode = @mcc AND testid IS NOT NULL`,
      );
    const pick = (tt: string) =>
      r.recordset
        .filter((x) => x.testtype === tt)
        .map((x) => [x.testid, x.rate] as [number, number]);
    return { tests: pick('T'), profiles: pick('P'), masters: pick('M') };
  });
}

/**
 * The active catalog priced for ONE client (MCC). Mirrors the tiered logic of
 * usp_telo_resolve_rate / resolveRatesBatch so the catalog shows the same price
 * the order would bill: per-MCC special rate first, then the client's assigned
 * rate-list price, then MRP as the fallback. `mccId == null` (or a client with
 * no rate list AND no special rates) => MRP for every row, preserving the
 * legacy "MRP pricing" view. Cost-free — returns the public (costCt-stripped)
 * shape with `rate`/`rateSource` added.
 *
 * Prices are read LIVE here (uncached catalogue for MRP + uncached rate maps +
 * uncached special rates) so MRP / rate-list / special-rate edits made in the
 * LIS during the day are reflected on the next catalog view — no cache lag. The
 * cached `loadCatalog()` is still used for the New Order test-search typeahead,
 * where freshness matters less and the final price is resolved live anyway.
 */
export async function loadCatalogPricedForMcc(
  mccId: number | null,
): Promise<CatalogItemPriced[]> {
  const base = await loadCatalogUncached();

  const withMrp = (i: CatalogItem): CatalogItemPriced => ({
    id: i.id,
    kind: i.kind,
    code: i.code,
    name: i.name,
    departmentId: i.departmentId,
    mrp: i.mrp,
    rate: i.mrp,
    rateSource: i.mrp != null ? 'mrp' : 'none',
  });

  if (mccId == null) return base.map(withMrp);

  const rateTypeId = await withRetry(async () => {
    const pool = await getPool();
    const rt = await pool
      .request()
      .input('mcc', sql.Int, mccId)
      .query<{ RateType: number | null }>(
        `SELECT RateType FROM dbo.tbl_med_mcc_unit_master WHERE id = @mcc`,
      );
    return rt.recordset[0]?.RateType ?? null;
  });

  // Special rates apply regardless of whether the MCC has a rate list.
  const special = await loadSpecialRatesForMcc(mccId);
  const specialTest = new Map<number, number>(special.tests);
  const specialProfile = new Map<number, number>(special.profiles);
  const specialMaster = new Map<number, number>(special.masters);

  const testRate = new Map<number, number>();
  const profileRate = new Map<number, number>();
  const masterRate = new Map<number, number>();
  if (rateTypeId != null) {
    const maps = await loadRateMapsForType(rateTypeId);
    for (const [k, v] of maps.tests) testRate.set(k, v);
    for (const [k, v] of maps.profiles) profileRate.set(k, v);
    for (const [k, v] of maps.masters) masterRate.set(k, v);
  }

  const specialOf = (i: CatalogItem) =>
    i.kind === 'test'
      ? specialTest.get(i.id)
      : i.kind === 'master'
        ? specialMaster.get(i.id)
        : specialProfile.get(i.id);
  const ratelistOf = (i: CatalogItem) =>
    i.kind === 'test'
      ? testRate.get(i.id)
      : i.kind === 'master'
        ? masterRate.get(i.id)
        : profileRate.get(i.id);

  return base.map((i) => {
    const sp = specialOf(i);
    if (sp != null) return { ...withMrp(i), rate: sp, rateSource: 'special' };
    const rl = ratelistOf(i);
    if (rl != null) return { ...withMrp(i), rate: rl, rateSource: 'ratelist' };
    return withMrp(i);
  });
}

/** In-memory fuzzy filter (code/name substring, case-insensitive). */
export function filterCatalog(
  items: CatalogItem[],
  q: string | undefined,
  kind: CatalogKind | 'all' = 'all',
  limit = 50,
): CatalogItem[] {
  const needle = (q ?? '').trim().toLowerCase();
  let out = items;
  if (kind !== 'all') out = out.filter((i) => i.kind === kind);
  if (needle) {
    out = out.filter(
      (i) =>
        i.name.toLowerCase().includes(needle) ||
        i.code.toLowerCase().includes(needle),
    );
  }
  return out.slice(0, limit);
}

export { sql };
