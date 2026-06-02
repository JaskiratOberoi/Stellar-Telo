import 'server-only';
import { createHash } from 'crypto';
import { getPool, sql, withRetry } from '@/db/pool';
import { cached, redis } from '@/lib/cache';

export type LogoPosition = 'left' | 'right';

export interface MccInvoiceConfig {
  mccId: number;
  labName: string | null;
  address: string | null;
  /** Header line 2 — falls back to the LIS centre when blank. */
  city: string | null;
  state: string | null;
  pincode: string | null;
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
  /** "On behalf of …" line: 'client' name, 'qugen', or null = auto (MDCARE-aware). */
  onBehalfMode: 'client' | 'qugen' | null;
  /** Footer disclaimer: true/false, or null = auto (MDCARE-aware). */
  showDisclaimer: boolean | null;
  /** Authorised Signatory block: true/false, or null = auto (MDCARE-aware). */
  showSignatory: boolean | null;
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
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  hasTopRightLogo: number;
  nobleLogoPosition: string | null;
  nobleLogoVisible: number | null;
  customLogoVisible: number | null;
  preparedBy: string | null;
  onBehalfMode: string | null;
  showDisclaimer: number | boolean | null;
  showSignatory: number | boolean | null;
}

function mapRow(row: RawRow): MccInvoiceConfig {
  const pos = (row.nobleLogoPosition ?? '').toLowerCase();
  const obm = (row.onBehalfMode ?? '').toLowerCase();
  return {
    mccId: row.mccId,
    labName: row.labName,
    address: row.address,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
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
    onBehalfMode: obm === 'qugen' ? 'qugen' : obm === 'client' ? 'client' : null,
    // null stays null (= "auto" — resolved MDCARE-aware at render time).
    showDisclaimer: row.showDisclaimer == null ? null : Boolean(row.showDisclaimer),
    showSignatory: row.showSignatory == null ? null : Boolean(row.showSignatory),
  };
}

/**
 * Returns true only if the table exists in the database. Memoised for the
 * lifetime of the Node process — the table is created once at deploy and
 * never dropped at runtime, so re-querying INFORMATION_SCHEMA on every admin
 * invoice page load (was: one hit per request) is pure overhead.
 *
 * A negative result is cached too but with a shorter expiry: if the operator
 * is in the middle of deploying the migration and the table appears mid-run,
 * we want to notice within a minute rather than require a process restart.
 */
let tableExistsMemo: { value: boolean; until: number } | null = null;
const TABLE_EXISTS_POS_TTL_MS = 60 * 60 * 1000;
const TABLE_EXISTS_NEG_TTL_MS = 60 * 1000;

async function tableExists(): Promise<boolean> {
  const now = Date.now();
  if (tableExistsMemo && tableExistsMemo.until > now) {
    return tableExistsMemo.value;
  }
  try {
    const pool = await getPool();
    const r = await pool.request().query<{ n: number }>(`
      SELECT COUNT(*) AS n
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME   = 'telo_mcc_invoice_config'
    `);
    const value = (r.recordset[0]?.n ?? 0) > 0;
    tableExistsMemo = {
      value,
      until: now + (value ? TABLE_EXISTS_POS_TTL_MS : TABLE_EXISTS_NEG_TTL_MS),
    };
    return value;
  } catch {
    tableExistsMemo = { value: false, until: now + TABLE_EXISTS_NEG_TTL_MS };
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
        .query<RawRow>(`
          SELECT mcc_id AS mccId, lab_name AS labName,
                 address, city, state, pincode, phone, email,
                 CASE WHEN top_right_logo_mime IS NOT NULL THEN 1 ELSE 0 END AS hasTopRightLogo,
                 noble_logo_position  AS nobleLogoPosition,
                 noble_logo_visible   AS nobleLogoVisible,
                 custom_logo_visible  AS customLogoVisible,
                 prepared_by          AS preparedBy,
                 on_behalf_mode       AS onBehalfMode,
                 show_disclaimer      AS showDisclaimer,
                 show_signatory       AS showSignatory
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
        .query<RawRow>(`
          SELECT mcc_id AS mccId, lab_name AS labName,
                 address, city, state, pincode, phone, email,
                 CASE WHEN top_right_logo_mime IS NOT NULL THEN 1 ELSE 0 END AS hasTopRightLogo,
                 noble_logo_position  AS nobleLogoPosition,
                 noble_logo_visible   AS nobleLogoVisible,
                 custom_logo_visible  AS customLogoVisible,
                 prepared_by          AS preparedBy,
                 on_behalf_mode       AS onBehalfMode,
                 show_disclaimer      AS showDisclaimer,
                 show_signatory       AS showSignatory
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

/**
 * Raw logo bytes for `/api/mcc-invoice-logo/[mccId]` — not loaded on
 * overview pages.
 *
 * Cached in Redis for 1 hour (logos are uploaded rarely — saveInvoiceConfig
 * busts the cache key whenever a new file is written). Cache stores the
 * mime + bytes as base64 inside a small JSON envelope so a downed/missing
 * Redis falls through to the live DB read transparently (cached() degrades
 * to direct compute on Redis failures).
 *
 * Why not the ETag fetch chain alone? The ETag handles repeat fetches from
 * the SAME browser. The Redis layer also handles fan-out across MANY
 * browsers asking the same Node process for the same MCC's logo and
 * absorbs cold-cache cost across rolling deploys.
 */
const LOGO_TTL_SECONDS = 60 * 60;

function logoCacheKey(mccId: number): string {
  return `telo:invoice-logo:${mccId}`;
}

interface CachedLogoEnvelope {
  mime: string;
  bytesB64: string;
}

export async function getMccInvoiceLogoBytes(
  mccId: number,
): Promise<MccInvoiceLogoBytes | null> {
  if (!Number.isInteger(mccId)) return null;
  try {
    const envelope = await cached<CachedLogoEnvelope | null>(
      logoCacheKey(mccId),
      LOGO_TTL_SECONDS,
      async () => {
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
          return {
            mime: row.mime,
            bytesB64: row.bytes.toString('base64'),
          };
        });
      },
    );
    if (!envelope) return null;
    return {
      mime: envelope.mime,
      bytes: Buffer.from(envelope.bytesB64, 'base64'),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid object name') || msg.includes('Invalid column name')) {
      return null;
    }
    throw err;
  }
}

/**
 * Strong ETag for the logo bytes — used by `/api/mcc-invoice-logo/[mccId]`.
 * Wraps the cached lookup so we don't pay a second DB hit just to hash. Falls
 * back to a per-mccId placeholder when no bytes are present (callers should
 * not use it in that path, but defensive against accidental misuse).
 */
export async function getMccInvoiceLogoEtag(mccId: number): Promise<string | null> {
  const logo = await getMccInvoiceLogoBytes(mccId);
  if (!logo) return null;
  return `"${createHash('sha1').update(logo.bytes).digest('hex')}"`;
}

/**
 * Bust the Redis cache for one MCC's logo bytes. Call from saveInvoiceConfig
 * after any write that changes top_right_logo_bytes / top_right_logo_mime
 * (upload OR removal). Best-effort — Redis-down silently falls through; the
 * TTL still bounds staleness to 1 hour.
 */
export async function invalidateMccInvoiceLogo(mccId: number): Promise<void> {
  if (!Number.isInteger(mccId)) return;
  try {
    await redis().del(logoCacheKey(mccId));
  } catch {
    /* best-effort */
  }
}

export { tableExists as invoiceConfigTableExists };
