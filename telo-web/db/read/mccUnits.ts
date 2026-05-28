import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface ScopedMcc {
  id: number; // tbl_med_mcc_unit_master.id (== scope mcc_code)
  code: string; // MCCUnitCode
  name: string | null;
}

/**
 * Every active MCC unit. Returned to admin/user-management so a Super Admin
 * can assign a client-code scope when onboarding a new user. ~1.7k rows —
 * acceptable to ship in the admin overview payload (the search picker filters
 * client-side).
 */
export async function fetchAllActiveMccs(): Promise<ScopedMcc[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .query<{ id: number; code: string; name: string | null }>(`
        SELECT id, MCCUnitCode AS code, MCCUnitName AS name
        FROM dbo.tbl_med_mcc_unit_master
        WHERE IsActive = 1
        ORDER BY MCCUnitName
      `);
    return r.recordset.map((x) => ({
      id: x.id,
      code: (x.code ?? '').trim(),
      name: x.name ? x.name.trim() : null,
    }));
  });
}

/**
 * Search active MCC units by code or name. Returns up to `limit` rows ordered
 * by name. Used by the admin picker so we never have to ship the full ~1.7k
 * MCC list to the browser just to power an autocomplete.
 *
 * `excludeIds` lets the caller hide MCCs already chosen as chips so the
 * dropdown shows only unselected options.
 */
export async function searchMccUnits(
  query: string,
  opts: { limit?: number; excludeIds?: number[] } = {},
): Promise<ScopedMcc[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 100));
  const q = (query ?? '').trim();
  // SQL Server's LIKE escape requires square brackets / underscores / percent
  // signs to be escaped via [ ]. Keep it simple: strip the chars and only
  // allow alphanumerics + a few separators in the LIKE seed. The full search
  // still goes through @q parameter binding so this is paranoia, not security.
  const safe = q.replace(/[%_\[\]]/g, ' ').slice(0, 80);
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool
      .request()
      .input('q', sql.NVarChar(100), `%${safe}%`)
      .input('lim', sql.Int, limit);
    const exclusionParams: string[] = [];
    (opts.excludeIds ?? []).slice(0, 200).forEach((id, i) => {
      if (!Number.isInteger(id)) return;
      const key = `x${i}`;
      req.input(key, sql.Int, id);
      exclusionParams.push(`@${key}`);
    });
    const exclusion =
      exclusionParams.length > 0
        ? `AND id NOT IN (${exclusionParams.join(',')})`
        : '';
    const where = safe
      ? `(MCCUnitCode LIKE @q OR MCCUnitName LIKE @q)`
      : `1 = 1`;
    const r = await req.query<{ id: number; code: string; name: string | null }>(
      `SELECT TOP (@lim) id, MCCUnitCode AS code, MCCUnitName AS name
         FROM dbo.tbl_med_mcc_unit_master
        WHERE IsActive = 1 ${exclusion} AND ${where}
        ORDER BY MCCUnitName`,
    );
    return r.recordset.map((x) => ({
      id: x.id,
      code: (x.code ?? '').trim(),
      name: x.name ? x.name.trim() : null,
    }));
  });
}

/** Resolve a small set of MCC unit ids to display rows (chip labels). */
export async function fetchMccUnitsByIds(
  ids: number[],
): Promise<ScopedMcc[]> {
  const clean = Array.from(
    new Set(ids.filter((n) => Number.isInteger(n) && n > 0)),
  ).slice(0, 500);
  if (clean.length === 0) return [];
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    const params = clean.map((id, i) => {
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
       WHERE id IN (${params.join(',')})
       ORDER BY MCCUnitName
    `);
    return r.recordset.map((x) => ({
      id: x.id,
      code: (x.code ?? '').trim(),
      name: x.name ? x.name.trim() : null,
    }));
  });
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
