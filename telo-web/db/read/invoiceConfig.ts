import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface MccInvoiceConfig {
  mccId: number;
  labName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
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
        }>(`
          SELECT mcc_id AS mccId, lab_name AS labName,
                 address, phone, email
          FROM ${TABLE}
          WHERE mcc_id = @mid
        `);
      return r.recordset[0] ?? null;
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
        }>(`
          SELECT mcc_id AS mccId, lab_name AS labName,
                 address, phone, email
          FROM ${TABLE}
          ORDER BY mcc_id
        `);
      return r.recordset;
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid object name')) return [];
    throw err;
  }
}

export { tableExists as invoiceConfigTableExists };
