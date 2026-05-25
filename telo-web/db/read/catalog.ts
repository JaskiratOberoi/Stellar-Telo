import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { cached } from '@/lib/cache';
import type { CatalogItem } from '@/domain/catalog/catalog.types';

/**
 * Active test + profile catalog. Listec does not expose the test catalog, so
 * this uses Telo's own pool with parameterised SELECTs. The full active set
 * (~1.5k tests + ~130 profiles) is small — load once, redis-cache 15 min,
 * filter/search in memory (P2). Per-MCC pricing is resolved later (P3).
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
  return cached('telo:catalog:v1', 900, loadCatalogUncached);
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
