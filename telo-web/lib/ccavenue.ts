import 'server-only';
import crypto from 'node:crypto';

/**
 * CCAvenue (Infibeam Avenues) non-seamless integration helpers.
 *
 * The scheme matches CCAvenue's official Node.js integration kit and the
 * legacy LIS (CCA.Util.CCACrypto): AES-128-CBC where the key is the MD5 digest
 * of the merchant Working Key and the IV is the fixed 0x00..0x0f byte run.
 * Request/response payloads are `&`-joined `key=value` strings, hex-encoded.
 *
 * Flow (mirrors LIS Pcc/ccavRequestHandler + ccavResponse):
 *   initiate → build request string → encryptCcavenue() → browser auto-POSTs
 *     { encRequest, access_code } to the gateway transaction URL.
 *   callback → decryptCcavenue(encResp) → parse → check order_status=Success.
 *
 * SECRETS: merchant_id / access_code / working_key come from env ONLY and are
 * never logged or committed. See lib/ccavenue.config.ts equivalent below.
 */

// Fixed 16-byte IV used by the CCAvenue kit (0x00,0x01,…,0x0f).
const INIT_VECTOR = Buffer.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
  0x0d, 0x0e, 0x0f,
]);

/** MD5 digest of the working key → the 16-byte AES-128 key. */
function deriveKey(workingKey: string): Buffer {
  return crypto.createHash('md5').update(workingKey, 'utf8').digest();
}

/** Encrypt a plaintext request string → hex (CCAvenue `encRequest`). */
export function encryptCcavenue(plainText: string, workingKey: string): string {
  const cipher = crypto.createCipheriv(
    'aes-128-cbc',
    deriveKey(workingKey),
    INIT_VECTOR,
  );
  return cipher.update(plainText, 'utf8', 'hex') + cipher.final('hex');
}

/** Decrypt a hex `encResp` from CCAvenue → the plaintext response string. */
export function decryptCcavenue(encText: string, workingKey: string): string {
  const decipher = crypto.createDecipheriv(
    'aes-128-cbc',
    deriveKey(workingKey),
    INIT_VECTOR,
  );
  // CCAvenue can return whitespace/newlines around the hex blob.
  const hex = (encText ?? '').replace(/\s+/g, '');
  return decipher.update(hex, 'hex', 'utf8') + decipher.final('utf8');
}

/**
 * Build the CCAvenue request string from an ordered param map. Values are
 * URL-encoded (CCAvenue parses with HttpUtility.ParseQueryString, so encoding
 * keeps stray `&`/`=` in names/addresses from breaking the field split).
 */
export function buildCcavenueRequest(
  params: Record<string, string | number | null | undefined>,
): string {
  return Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** Parse a decrypted CCAvenue response string into a flat object. */
export function parseCcavenueResponse(decrypted: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (decrypted ?? '').split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx);
    const val = pair.slice(idx + 1);
    out[key] = decodeURIComponent(val.replace(/\+/g, ' '));
  }
  return out;
}

// ── Config ──────────────────────────────────────────────────────────────────

export interface CcavenueConfig {
  merchantId: string;
  accessCode: string;
  workingKey: string;
  /** Gateway transaction endpoint (prod vs test). */
  requestUrl: string;
  /** Absolute URL CCAvenue redirects back to after a transaction. */
  redirectUrl: string;
  /** Absolute URL CCAvenue posts to on cancel/abort. */
  cancelUrl: string;
  currency: string;
}

const DEFAULT_REQUEST_URL =
  'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction';

/**
 * Resolve CCAvenue config from env. Returns null when the integration is not
 * configured (no merchant id / access code / working key) — callers treat that
 * as "online payments are off" rather than crashing. Keys live ONLY in env.
 */
export function getCcavenueConfig(): CcavenueConfig | null {
  const merchantId = process.env.CCAVENUE_MERCHANT_ID?.trim();
  const accessCode = process.env.CCAVENUE_ACCESS_CODE?.trim();
  const workingKey = process.env.CCAVENUE_WORKING_KEY?.trim();
  if (!merchantId || !accessCode || !workingKey) return null;

  // Redirect/cancel can be given absolutely, or derived from the app's public
  // base URL (the externally-reachable origin CCAvenue knows — must match the
  // URL registered against this access code).
  const base = (
    process.env.CCAVENUE_BASE_URL ||
    process.env.REPORT_PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    ''
  ).replace(/\/+$/, '');

  const redirectUrl =
    process.env.CCAVENUE_REDIRECT_URL?.trim() ||
    (base ? `${base}/api/ccavenue/callback` : '');
  const cancelUrl =
    process.env.CCAVENUE_CANCEL_URL?.trim() ||
    (base ? `${base}/api/ccavenue/callback` : '');

  if (!redirectUrl || !cancelUrl) return null;

  return {
    merchantId,
    accessCode,
    workingKey,
    requestUrl: process.env.CCAVENUE_REQUEST_URL?.trim() || DEFAULT_REQUEST_URL,
    redirectUrl,
    cancelUrl,
    currency: process.env.CCAVENUE_CURRENCY?.trim() || 'INR',
  };
}

/** Cheap boolean for UI gating ("show the Pay Now button only if configured"). */
export function isCcavenueConfigured(): boolean {
  return getCcavenueConfig() !== null;
}

/**
 * Generate a unique, gateway-safe order id (≤30 chars, A–Z0–9). Time-prefixed
 * for rough ordering + random suffix for uniqueness/unguessability.
 */
export function newOrderId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `T${ts}${rand}`.slice(0, 30);
}
