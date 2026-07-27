import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface ScopedMcc {
  id: number; // tbl_med_mcc_unit_master.id (== scope mcc_code)
  code: string; // MCCUnitCode
  name: string | null;
}

/** A scoped MCC with its parent Business Unit — for the Client-Accounts filter
 *  bar, where Business Unit narrows the client switcher (mirrors the LIS). */
export interface ScopedClient extends ScopedMcc {
  buId: number | null; // tbl_med_mcc_unit_master.BusinessUnitCode → business_unit.id
  buName: string | null;
}

/** A collection centre's contact details, for the report's "Collected at". */
export interface CollectionCentre {
  code: string;
  name: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * The collection centre (MCC unit) for a report's client/customer code, with
 * its address + contact details — shown as "Collected at" in the report header.
 * Keyed by MCCUnitCode (== the sample's client_code). Read live; the per-report
 * lookup is a single indexed row. Returns null when the code has no centre.
 */
export async function getMccCentreByCode(
  code: string | null | undefined,
): Promise<CollectionCentre | null> {
  const c = (code ?? '').trim();
  if (!c) return null;
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('c', sql.NVarChar(50), c)
      .query<{
        code: string;
        name: string | null;
        address: string | null;
        city: string | null;
        phone: string | null;
        email: string | null;
      }>(`
        SELECT TOP 1 MCCUnitCode AS code, MCCUnitName AS name,
               address, city, phone, email
        FROM dbo.tbl_med_mcc_unit_master
        WHERE MCCUnitCode = @c
      `);
    const x = r.recordset[0];
    if (!x) return null;
    const trim = (s: string | null) => {
      const t = (s ?? '').trim();
      return t || null;
    };
    return {
      code: (x.code ?? '').trim(),
      name: trim(x.name),
      address: trim(x.address),
      city: trim(x.city),
      phone: trim(x.phone),
      email: trim(x.email),
    };
  });
}

/**
 * ⚠️ `tbl_med_mcc_unit_master.IsActive` IS NOT A LIVENESS FLAG for client codes
 * in this deployment, and NOTHING here may filter on it.
 *
 * More than half the network (1,735 of 3,571 codes) carries IsActive = 0, yet
 * 841 of those placed orders in the last 90 days — including some of the very
 * busiest clients (DL0416, DL0214, SAMARPAN). The LIS knows this: both client
 * pickers in MedCis (Utilities.FillCombo "PCC") carry an explicitly
 * commented-out `//where c.IsActive == true`, and PatientWorkOrder's
 * GetMCCCompletionList has no IsActive filter at all — while the test/profile
 * autocompletes right beside it DO filter on IsActive. The omission is
 * deliberate.
 *
 * Telo used to filter on it, which silently hid half the client list from the
 * New Order autocomplete. Do not reintroduce the filter.
 */

/**
 * Every MCC unit. Returned to admin/user-management so a Super Admin can
 * assign a client-code scope when onboarding a new user. ~3.5k rows —
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
 * Search MCC units by code or name — the New Order / admin client-code
 * autocomplete. Returns up to `limit` rows ordered by name. Mirrors the LIS's
 * GetMCCCompletionList (PatientWorkOrder.aspx.cs), which matches on code OR
 * name and does NOT filter on IsActive — see the note above fetchAllActiveMccs.
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
        WHERE ${where} ${exclusion}
        ORDER BY MCCUnitName`,
    );
    return r.recordset.map((x) => ({
      id: x.id,
      code: (x.code ?? '').trim(),
      name: x.name ? x.name.trim() : null,
    }));
  });
}

/**
 * Like fetchScopedMccUnits but also resolves each centre's Business Unit, for
 * the Client-Accounts filter bar (BU narrows the client switcher).
 *
 * `ownIds` is retained for call-site compatibility but is now a no-op: nothing
 * filters on IsActive, so an "own centre flagged inactive" override has nothing
 * left to override.
 */
export async function fetchScopedClients(
  scopeIds: number[],
  ownIds: number[] = [],
): Promise<ScopedClient[]> {
  const ids = scopeIds.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  const own = ownIds.filter((n) => Number.isInteger(n) && ids.includes(n));
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    const params = ids.map((id, i) => {
      req.input(`u${i}`, sql.Int, id);
      return `@u${i}`;
    });
    void own; // see below: no IsActive filter, so the own-centre override is moot
    const r = await req.query<{
      id: number;
      code: string;
      name: string | null;
      buId: number | null;
      buName: string | null;
    }>(`
      SELECT u.id, u.MCCUnitCode AS code, u.MCCUnitName AS name,
             u.BusinessUnitCode AS buId, b.BusinessUnitName AS buName
      FROM dbo.tbl_med_mcc_unit_master u
      LEFT JOIN dbo.tbl_med_business_unit_master b ON b.id = u.BusinessUnitCode
      WHERE u.id IN (${params.join(',')})
      ORDER BY u.MCCUnitName
    `);
    return r.recordset.map((x) => ({
      id: x.id,
      code: (x.code ?? '').trim(),
      name: x.name ? x.name.trim() : null,
      buId: x.buId ?? null,
      buName: x.buName ? x.buName.trim() : null,
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
 *
 * No IsActive filter — it is not a liveness flag for client codes (see the note
 * above fetchAllActiveMccs). `ownIds` is retained for call-site compatibility
 * but is now a no-op: it existed to surface the caller's own centre when the
 * LIS had it flagged inactive, and there is no longer a filter to escape.
 */
export async function fetchScopedMccUnits(
  scopeIds: number[],
  ownIds: number[] = [],
): Promise<ScopedMcc[]> {
  const ids = scopeIds.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  // Only honour own-ids that are actually in scope.
  const own = ownIds.filter((n) => Number.isInteger(n) && ids.includes(n));

  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    const params = ids.map((id, i) => {
      req.input(`u${i}`, sql.Int, id);
      return `@u${i}`;
    });
    void own; // see below: no IsActive filter, so the own-centre override is moot
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
