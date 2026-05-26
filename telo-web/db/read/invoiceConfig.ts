import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface MccInvoiceConfig {
  mccId: number;
  labName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** True when a custom top-right logo is stored in Telo config (not LIS). */
  hasTopRightLogo: boolean;
}

export interface MccInvoiceLogoBytes {
  mime: string;
  bytes: Buffer;
}

const TABLE = 'dbo.telo_mcc_invoice_config';

/** Returns true only if the table exists in the database. */
async function tableExists(): Promise<boolean> {
  try {
    const pool = await getPool();
    const r = await pool.request().query<{ n: number }>(`
      SELECT COUNT(*) AS n
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME   = 'telo_mcc_invoice_config'
    `);
    return (r.recordset[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Fetch the invoice branding config for a single MCC, or null if not set.
 * Returns null gracefully if the migration table does not yet exist.
 */
export async function getMccInvoiceConfig(
  mccId: number,
): Promise<MccInvoiceConfig | null> {
  if (!Number.isInteger(mccId)) return null;
  try {
    return await withRetry(async () => {
      const pool = await getPool();
      const r = await pool
        .request()
        .input('mid', sql.Int, mccId)
        .query<{
          mccId: number;
          labName: string | null;
          address: string | null;
          phone: string | null;
          email: string | null;
          hasTopRightLogo: number;
        }>(`
          SELECT mcc_id AS mccId, lab_name AS labName,
                 address, phone, email,
                 CASE WHEN top_right_logo_mime IS NOT NULL THEN 1 ELSE 0 END AS hasTopRightLogo
          FROM ${TABLE}
          WHERE mcc_id = @mid
        `);
      const row = r.recordset[0];
      if (!row) return null;
      return { ...row, hasTopRightLogo: row.hasTopRightLogo === 1 };
    });
  } catch (err: unknown) {
    // Table doesn't exist yet (migration not run) — degrade gracefully.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid object name')) return null;
    throw err;
  }
}

/**
 * All configs — used on the admin invoice-config management page.
 * Returns [] gracefully if the migration table does not yet exist.
 */
export async function getAllMccInvoiceConfigs(): Promise<MccInvoiceConfig[]> {
  try {
    return await withRetry(async () => {
      const pool = await getPool();
      const r = await pool
        .request()
        .query<{
          mccId: number;
          labName: string | null;
          address: string | null;
          phone: string | null;
          email: string | null;
          hasTopRightLogo: number;
        }>(`
          SELECT mcc_id AS mccId, lab_name AS labName,
                 address, phone, email,
                 CASE WHEN top_right_logo_mime IS NOT NULL THEN 1 ELSE 0 END AS hasTopRightLogo
          FROM ${TABLE}
          ORDER BY mcc_id
        `);
      return r.recordset.map((row) => ({
        ...row,
        hasTopRightLogo: row.hasTopRightLogo === 1,
      }));
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid object name')) return [];
    throw err;
  }
}

/** Raw logo bytes for `/api/mcc-invoice-logo/[mccId]` — not loaded on overview pages. */
export async function getMccInvoiceLogoBytes(
  mccId: number,
): Promise<MccInvoiceLogoBytes | null> {
  if (!Number.isInteger(mccId)) return null;
  try {
    return await withRetry(async () => {
      const pool = await getPool();
      const r = await pool
        .request()
        .input('mid', sql.Int, mccId)
        .query<{
          mime: string | null;
          bytes: Buffer | null;
        }>(`
          SELECT top_right_logo_mime AS mime,
                 top_right_logo_bytes AS bytes
          FROM ${TABLE}
          WHERE mcc_id = @mid
            AND top_right_logo_mime IS NOT NULL
            AND top_right_logo_bytes IS NOT NULL
        `);
      const row = r.recordset[0];
      if (!row?.mime || !row.bytes) return null;
      return { mime: row.mime, bytes: row.bytes };
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid object name') || msg.includes('Invalid column name')) {
      return null;
    }
    throw err;
  }
}

export { tableExists as invoiceConfigTableExists };
