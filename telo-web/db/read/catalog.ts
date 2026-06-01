import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { cached } from '@/lib/cache';
import type {
  CatalogItem,
  CatalogItemPriced,
} from '@/domain/catalog/catalog.types';

/**
 * Active test + profile catalog. Listec does not expose the test catalog, so
 * this uses Telo's own pool with parameterised SELECTs. The full active set
 * (~1.5k tests + ~130 profiles) is small — load once, briefly redis-cache,
 * filter/search in memory (P2). Per-MCC pricing is resolved later (P3).
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
      ORDER BY name
    `);
    return r.recordset.map((x) => ({
      id: x.id,
      kind: x.kind === 'profile' ? 'profile' : 'test',
      code: (x.code ?? '').trim(),
      name: (x.name ?? '').trim(),
      departmentId: x.departmentId ?? null,
      mrp: x.mrp ?? null,
      costCt: x.costCt ?? null,
    }));
  });
}

export async function loadCatalog(): Promise<CatalogItem[]> {
  return cached('telo:catalog:v1', 60, loadCatalogUncached);
}

/**
 * The full rate-list price map for one RateType. Read LIVE (not cached) so a
 * rate-list edit made in the LIS during the day shows up in the catalog
 * immediately — there's no re-sync step. One query pair per catalog page view
 * (low-traffic, internal); rates are indexed by RateTypeId.
 */
async function loadRateMapsForType(
  rateTypeId: number,
): Promise<{ tests: [number, number][]; profiles: [number, number][] }> {
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
    return {
      tests: tr.recordset.map((r) => [r.TestCode, r.Price] as [number, number]),
      profiles: pr.recordset.map(
        (r) => [r.profilecode, r.Price] as [number, number],
      ),
    };
  });
}

/**
 * The active catalog priced for ONE client (MCC). Mirrors the two-tier logic of
 * usp_telo_resolve_rate / resolveRatesBatch so the catalog shows the same price
 * the order would bill: the client's assigned rate-list price first, MRP as the
 * fallback. `mccId == null` (or a client with no rate list) => MRP for every
 * row, preserving the legacy "MRP pricing" view. Cost-free — returns the public
 * (costCt-stripped) shape with `rate`/`rateSource` added.
 *
 * Prices are read LIVE here (uncached catalogue for MRP + uncached rate maps)
 * so MRP / rate-list edits made in the LIS during the day are reflected on the
 * next catalog view — no 15-min cache lag. The cached `loadCatalog()` is still
 * used for the New Order test-search typeahead, where freshness matters less
 * and the final price is resolved live at pricing time anyway.
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

  if (rateTypeId == null) return base.map(withMrp);

  const maps = await loadRateMapsForType(rateTypeId);
  const testRate = new Map<number, number>(maps.tests);
  const profileRate = new Map<number, number>(maps.profiles);

  return base.map((i) => {
    const rl = i.kind === 'test' ? testRate.get(i.id) : profileRate.get(i.id);
    if (rl != null) return { ...withMrp(i), rate: rl, rateSource: 'ratelist' };
    return withMrp(i);
  });
}

/** In-memory fuzzy filter (code/name substring, case-insensitive). */
export function filterCatalog(
  items: CatalogItem[],
  q: string | undefined,
  kind: 'test' | 'profile' | 'all' = 'all',
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
