const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

const ALLOWED_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 6 && buf.subarray(0, 6).toString('ascii') === 'GIF87a') {
    return 'image/gif';
  }
  if (buf.length >= 6 && buf.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return 'image/gif';
  }
  return null;
}

export type ParsedLogoUpload = { buffer: Buffer; mime: string };

/**
 * Reads an optional top-right logo from multipart form data.
 * Returns null when no file attached. Throws on invalid type/size.
 */
export async function readTopRightLogo(
  formData: FormData,
): Promise<ParsedLogoUpload | null> {
  const entry = formData.get('topRightLogo');
  if (!(entry instanceof File) || entry.size === 0) return null;

  if (entry.size > MAX_LOGO_BYTES) {
    throw new Error('Logo must be 2 MB or smaller.');
  }

  const buffer = Buffer.from(await entry.arrayBuffer());
  const sniffed = sniffImageMime(buffer);
  if (!sniffed || !ALLOWED_MIMES.has(sniffed)) {
    throw new Error('Logo must be a PNG, JPEG, WebP, or GIF image.');
  }
  if (entry.type && entry.type !== sniffed && entry.type !== 'image/jpg') {
    // Browsers sometimes send image/jpg for JPEG — sniffed mime is authoritative.
    if (!(sniffed === 'image/jpeg' && entry.type === 'image/jpg')) {
      throw new Error('Logo file type does not match its contents.');
    }
  }

  return { buffer, mime: sniffed };
}

/** Built-in Medicare co-brand codes — used when no custom logo is uploaded. */
export const MEDICARE_MCC_CODES = new Set(['medicare_test', 'medicare_tech']);

export function medicareLogoPath(): string {
  return '/branding/medicare-logo.png';
}

export function customLogoApiPath(mccId: number): string {
  return `/api/mcc-invoice-logo/${mccId}`;
}
