import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Telo-only ("custom") tests — charges Telo bills but the LIS never performs
 * (e.g. "Glucose - External", done by hospital staff, billed by us). They live
 * in dbo.telo_custom_test, are scoped to a specific client code (MCCUnitCode),
 * and never link to tbl_med_test_master. See 103_table_telo_custom_test.sql.
 *
 * Read straight from the DB (no cache): the set is tiny and edits are rare, and
 * pricing here is authoritative (it's what the order bills), so freshness wins.
 */

/** Client-safe custom test — no internal/cost fields to leak. */
export interface CustomTestPublic {
  id: number;
  code: string;
  name: string;
  mrp: number;
  requiresMrd: boolean;
  allowQty: boolean;
}

interface CustomTestRow {
  id: number;
  code: string;
  name: string;
  mrp: number;
  requires_mrd: boolean;
  allow_qty: boolean;
}

const mapRow = (x: CustomTestRow): CustomTestPublic => ({
  id: x.id,
  code: (x.code ?? '').trim(),
  name: (x.name ?? '').trim(),
  mrp: x.mrp ?? 0,
  requiresMrd: x.requires_mrd === true,
  allowQty: x.allow_qty === true,
});

/** The MCCUnitCode (client code) for an MCC id, or null if unknown/inactive. */
export async function clientCodeForMcc(mccId: number): Promise<string | null> {
  if (!Number.isInteger(mccId) || mccId <= 0) return null;
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('id', sql.Int, mccId)
      .query<{ code: string | null }>(
        `SELECT MCCUnitCode AS code FROM dbo.tbl_med_mcc_unit_master WHERE id = @id`,
      );
    const code = r.recordset[0]?.code;
    return code ? code.trim() : null;
  });
}

/** Active custom tests offered for a given client code. */
export async function loadCustomTestsForClientCode(
  clientCode: string,
): Promise<CustomTestPublic[]> {
  const code = (clientCode ?? '').trim();
  if (!code) return [];
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('cc', sql.NVarChar(50), code)
      .query<CustomTestRow>(
        `SELECT id, code, name, mrp, requires_mrd, allow_qty
         FROM dbo.telo_custom_test
         WHERE is_active = 1 AND client_code = @cc
         ORDER BY name`,
      );
    return r.recordset.map(mapRow);
  });
}

/** Active custom tests offered for a given MCC id (resolves its client code). */
export async function loadCustomTestsForMcc(
  mccId: number,
): Promise<CustomTestPublic[]> {
  const code = await clientCodeForMcc(mccId);
  if (!code) return [];
  return loadCustomTestsForClientCode(code);
}

/**
 * Authoritative fetch of ONE active custom test scoped to a client code — used
 * at order submit to re-resolve price/name/flags server-side (never trust the
 * client). Returns null if it isn't an active custom test for that client.
 */
export async function loadCustomTestForClient(
  id: number,
  clientCode: string,
): Promise<CustomTestPublic | null> {
  const code = (clientCode ?? '').trim();
  if (!Number.isInteger(id) || id <= 0 || !code) return null;
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('id', sql.Int, id)
      .input('cc', sql.NVarChar(50), code)
      .query<CustomTestRow>(
        `SELECT id, code, name, mrp, requires_mrd, allow_qty
         FROM dbo.telo_custom_test
         WHERE id = @id AND client_code = @cc AND is_active = 1`,
      );
    const row = r.recordset[0];
    return row ? mapRow(row) : null;
  });
}
