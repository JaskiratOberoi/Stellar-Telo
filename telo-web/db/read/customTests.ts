import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Telo-only ("custom") tests — charges Telo bills but the LIS never performs
 * (e.g. "Glucose - External", done by hospital staff, billed by us). They live
 * in dbo.telo_custom_test, are scoped to a specific client code (MCCUnitCode),
 * and never link to tbl_med_test_master. See 103_table_telo_custom_test.sql.
 *
 * client_code '*' is the "every client" sentinel (e.g. 'Smart Report' @ ₹99,
 * network-wide) — every per-client read below includes '*' rows. It can never
 * collide with a real MCCUnitCode.
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
         WHERE is_active = 1 AND client_code IN (@cc, N'*')
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

/** The custom-test code whose purchase unlocks the Smart Report button for a
 *  patient's reports. Matches the 106_seed_smart_report_all_clients.sql seed. */
export const SMART_REPORT_CODE = 'SMART-RPT';

/**
 * Of the given patient ids, the ones whose order includes the Smart Report
 * custom test — i.e. the patients whose reports may show the Smart Report
 * button. Batch lookup for the reporting list (one indexed query; patient_id
 * is indexed on telo_custom_test_order).
 */
export async function pidsWithSmartReport(
  pids: number[],
): Promise<Set<number>> {
  const clean = Array.from(
    new Set(pids.filter((n) => Number.isInteger(n) && n > 0)),
  ).slice(0, 1000);
  if (clean.length === 0) return new Set();
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('code', sql.NVarChar(50), SMART_REPORT_CODE);
    const params = clean.map((id, i) => {
      req.input(`p${i}`, sql.Int, id);
      return `@p${i}`;
    });
    const r = await req.query<{ patient_id: number }>(
      `SELECT DISTINCT patient_id
         FROM dbo.telo_custom_test_order
        WHERE code = @code AND patient_id IN (${params.join(',')})`,
    );
    return new Set(r.recordset.map((x) => x.patient_id));
  });
}

/**
 * Whether this SID's patient bought the Smart Report — the server-side gate
 * for the smart print fragment and smart-pdf route (the hidden button is UI
 * courtesy; this is the enforcement).
 */
export async function sidHasSmartReport(sid: string): Promise<boolean> {
  const target = (sid ?? '').trim();
  if (!target) return false;
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('sid', sql.NVarChar(50), target)
      .input('code', sql.NVarChar(50), SMART_REPORT_CODE)
      .query<{ n: number }>(
        `SELECT TOP 1 1 AS n
           FROM dbo.tbl_med_mcc_patient_samples s
           JOIN dbo.telo_custom_test_order o ON o.patient_id = s.patient_id
          WHERE s.vailid = @sid AND o.code = @code`,
      );
    return r.recordset.length > 0;
  });
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
         WHERE id = @id AND client_code IN (@cc, N'*') AND is_active = 1`,
      );
    const row = r.recordset[0];
    return row ? mapRow(row) : null;
  });
}
