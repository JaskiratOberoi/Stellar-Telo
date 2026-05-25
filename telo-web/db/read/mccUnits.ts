import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface ScopedMcc {
  id: number; // tbl_med_mcc_unit_master.id (== scope mcc_code)
  code: string; // MCCUnitCode
  name: string | null;
}

/**
 * Resolve the user's in-scope MCC unit ids to display rows. Scope is by unit
 * id (the mapping table's mcc_code); Listec's /api/mcc-units keys by code, so
 * we read id/code/name straight from tbl_med_mcc_unit_master here.
 */
export async function fetchScopedMccUnits(
  scopeIds: number[],
): Promise<ScopedMcc[]> {
  const ids = scopeIds.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];

  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    const params = ids.map((id, i) => {
      req.input(`u${i}`, sql.Int, id);
      return `@u${i}`;
    });
    const r = await req.query<{
      id: number;
      code: string;
      name: string | null;
    }>(`
      SELECT id, MCCUnitCode AS code, MCCUnitName AS name
      FROM dbo.tbl_med_mcc_unit_master
      WHERE id IN (${params.join(',')}) AND IsActive = 1
      ORDER BY MCCUnitName
    `);
    return r.recordset.map((x) => ({
      id: x.id,
      code: (x.code ?? '').trim(),
      name: x.name ? x.name.trim() : null,
    }));
  });
}
