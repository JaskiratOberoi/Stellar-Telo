import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import QRCode from 'qrcode';

/**
 * Patient-facing report link + QR. The printed report carries a QR that encodes
 * a PUBLIC, token-gated URL (`/r/<sid>?t=…`) from which a patient can fetch the
 * softcopy PDF without logging in. The token is an HMAC of the SID with a server
 * secret, so it can't be forged or used to enumerate other SIDs — only the
 * token printed on a given report opens that report.
 */

function secret(): string {
  return process.env.REPORT_TOKEN_SECRET || process.env.NEXTAUTH_SECRET || '';
}

/** Stable, unguessable token for a SID (HMAC-SHA256, base64url, 24 chars). */
export function reportToken(sid: string): string {
  const s = secret();
  if (!s) return '';
  return createHmac('sha256', s)
    .update(`telo:report:${sid.trim()}`)
    .digest('base64url')
    .slice(0, 24);
}

/** Constant-time check that `token` is the valid token for `sid`. */
export function verifyReportToken(sid: string, token: string | null | undefined): boolean {
  const expected = reportToken(sid);
  const got = (token ?? '').trim();
  if (!expected || !got || expected.length !== got.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(got));
  } catch {
    return false;
  }
}

/** Public base URL for patient links (the printed QR must resolve here). Set
 *  REPORT_PUBLIC_BASE_URL in prod (e.g. https://telo.genomicslab.in); falls back
 *  to NEXTAUTH_URL. */
function publicBaseUrl(): string {
  return (process.env.REPORT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || '').replace(
    /\/+$/,
    '',
  );
}

/** The public softcopy URL a patient scans to download/verify the report, or
 *  null if no base/secret is configured. */
export function reportPublicUrl(sid: string, dateHint?: string | null): string | null {
  const base = publicBaseUrl();
  const tok = reportToken(sid);
  if (!base || !tok) return null;
  const d = dateHint && /^\d{4}-\d{2}-\d{2}$/.test(dateHint) ? `&d=${dateHint}` : '';
  return `${base}/r/${encodeURIComponent(sid.trim())}?t=${tok}${d}`;
}

/** QR PNG data-URI for the report's public URL (null if no URL available). */
export async function reportQrDataUrl(
  sid: string,
  dateHint?: string | null,
): Promise<string | null> {
  const url = reportPublicUrl(sid, dateHint);
  if (!url) return null;
  try {
    return await QRCode.toDataURL(url, {
      margin: 0,
      width: 200,
      errorCorrectionLevel: 'M',
    });
  } catch {
    return null;
  }
}
