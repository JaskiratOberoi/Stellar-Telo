import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export type LogoPosition = 'left' | 'right';

export interface MccInvoiceConfig {
  mccId: number;
  labName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** True when a custom top-right logo is stored in Telo config (not LIS). */
  hasTopRightLogo: boolean;
  /** Default 'left' when null. Custom logo always renders on the opposite side. */
  nobleLogoPosition: LogoPosition;
  nobleLogoVisible: boolean;
  customLogoVisible: boolean;
  /** Name shown above the Notes block on the printed bill (e.g. receptionist). */
  preparedBy: string | null;
}

export interface MccInvoiceLogoBytes {
  mime: string;
  bytes: Buffer;
}

const TABLE = 'dbo.telo_mcc_invoice_config';

interface RawRow {
  mccId: number;
  labName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  hasTopRightLogo: number;
  nobleLogoPosition: string | null;
  nobleLogoVisible: number | null;
  customLogoVisible: number | null;
  preparedBy: string | null;
}

function mapRow(row: RawRow): MccInvoiceConfig {
  const pos = (row.nobleLogoPosition ?? '').toLowerCase();
  return {
    mccId: row.mccId,
    labName: row.labName,
    address: row.address,
    phone: row.phone,
    email: row.email,
    // `hasTopRightLogo` is derived in SQL as CASE ... THEN 1 ELSE 0 END so it
    // arrives as INT — but the underlying BIT columns (noble/custom_logo_visible)
    // arrive from node-mssql as JS booleans, not 0/1. Using Boolean() here makes
    // the coercion safe for either representation (e.g. if the driver behaviour
    // ever changes or the schema migrates BIT → TINYINT). This precise mismatch
    // was a silent footgun: `true === 1` is `false` in JS, so the previous
    // strict-equality check returned the WRONG visibility flags and made
    // custom-logo bills look unconfigured even when they were saved correctly.
    hasTopRightLogo: Boolean(row.hasTopRightLogo),
    nobleLogoPosition: pos === 'right' ? 'right' : 'left',
    // Default visible (true) when the column is null.
    nobleLogoVisible: row.nobleLogoVisible == null ? true : Boolean(row.nobleLogoVisible),
    customLogoVisible: row.customLogoVisible == null ? true : Boolean(row.customLogoVisible),
    preparedBy: row.preparedBy,
  };
}

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
          nobleLogoPosition: string | null;
          nobleLogoVisible: number | null;
          customLogoVisible: number | null;
          preparedBy: string | null;
        }>(`
          SELECT mcc_id AS mccId, lab_name AS labName,
                 address, phone, email,
                 CASE WHEN top_right_logo_mime IS NOT NULL THEN 1 ELSE 0 END AS hasTopRightLogo,
                 noble_logo_position  AS nobleLogoPosition,
                 noble_logo_visible   AS nobleLogoVisible,
                 custom_logo_visible  AS customLogoVisible,
                 prepared_by          AS preparedBy
          FROM ${TABLE}
          WHERE mcc_id = @mid
        `);
      const row = r.recordset[0];
      if (!row) return null;
      return mapRow(row);
    });
  } catch (err: unknown) {
    // Table doesn't exist yet (migration not run) — degrade gracefully.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid object name') || msg.includes('Invalid column name')) return null;
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
          nobleLogoPosition: string | null;
          nobleLogoVisible: number | null;
          customLogoVisible: number | null;
          preparedBy: string | null;
        }>(`
          SELECT mcc_id AS mccId, lab_name AS labName,
                 address, phone, email,
                 CASE WHEN top_right_logo_mime IS NOT NULL THEN 1 ELSE 0 END AS hasTopRightLogo,
                 noble_logo_position  AS nobleLogoPosition,
                 noble_logo_visible   AS nobleLogoVisible,
                 custom_logo_visible  AS customLogoVisible,
                 prepared_by          AS preparedBy
          FROM ${TABLE}
          ORDER BY mcc_id
        `);
      return r.recordset.map(mapRow);
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid object name') || msg.includes('Invalid column name')) return [];
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
