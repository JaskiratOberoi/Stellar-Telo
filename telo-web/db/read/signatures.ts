import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { cached } from '@/lib/cache';

/**
 * Reporting-report signature + "Processed at" data. The worksheet rows carry
 * the business-unit *name* but the report footer needs:
 *   - the processing centre's address/phone ("Processed at" line), and
 *   - the signing doctors' names, designations and signature images,
 * both keyed by the business unit. These live in `tbl_med_business_unit_master`
 * and `tbl_med_signature_master` (image in a VARBINARY(MAX) column), which the
 * worksheet SP does not expose — so we read them directly from Noble.
 */

export interface BusinessUnitInfo {
  id: number;
  name: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
}

export interface ReportSigner {
  id: number;
  doctorName: string | null;
  designation: string | null;
  /** DOC_TYPE: 1 = primary, 2 = secondary — controls left/right ordering. */
  docType: number | null;
}

export interface SignatureBytes {
  mime: string;
  bytes: Buffer;
}

/** Resolve a business unit by its name or code (as it appears on a worksheet row). */
export async function resolveBusinessUnit(
  buNameOrCode: string | null | undefined,
): Promise<BusinessUnitInfo | null> {
  const key = (buNameOrCode ?? '').trim();
  if (!key) return null;

  return cached<BusinessUnitInfo | null>(
    `telo:report:bu:${key.toLowerCase()}`,
    60 * 60,
    () =>
      withRetry(async () => {
        const pool = await getPool();
        const r = await pool
          .request()
          .input('key', sql.NVarChar(200), key)
          .query<{
            id: number;
            name: string | null;
            address: string | null;
            city: string | null;
            phone: string | null;
          }>(`
            SELECT TOP (1)
              id, BusinessUnitName AS name, address, city, phone
            FROM dbo.tbl_med_business_unit_master
            WHERE BusinessUnitName = @key OR BusinessUnitCode = @key
            ORDER BY IsActive DESC, id DESC
          `);
        const row = r.recordset[0];
        if (!row) return null;
        return {
          id: row.id,
          name: row.name?.trim() || null,
          address: row.address?.trim() || null,
          city: row.city?.trim() || null,
          phone: row.phone?.trim() || null,
        };
      }),
  );
}

/** Active signers for a business unit, ordered primary → secondary. */
export async function getSignersForBusinessUnit(
  businessUnitId: number,
): Promise<ReportSigner[]> {
  if (!Number.isInteger(businessUnitId)) return [];

  return cached<ReportSigner[]>(
    `telo:report:signers:${businessUnitId}`,
    60 * 60,
    () =>
      withRetry(async () => {
        const pool = await getPool();
        const r = await pool
          .request()
          .input('bu', sql.Int, businessUnitId)
          .query<{
            id: number;
            doctorName: string | null;
            designation: string | null;
            docType: number | null;
          }>(`
            SELECT id, Doctorname AS doctorName, Designation AS designation,
                   DOC_TYPE AS docType
            FROM dbo.tbl_med_signature_master
            WHERE Business_Unit_id = @bu
              AND ISNULL(IsActive, 1) = 1
              AND Signature IS NOT NULL
            ORDER BY ISNULL(DOC_TYPE, 99), id
          `);
        return r.recordset.map((x) => ({
          id: x.id,
          doctorName: x.doctorName?.trim() || null,
          designation: x.designation?.trim() || null,
          docType: x.docType,
        }));
      }),
  );
}

/** Sniff the image type of a signature blob (PNG/JPEG/GIF), default PNG. */
function sniffMime(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'image/jpeg';
  if (buf.length >= 6 && buf.subarray(0, 3).toString('ascii') === 'GIF')
    return 'image/gif';
  return 'image/png';
}

interface CachedSigEnvelope {
  mime: string;
  bytesB64: string;
}

/** Raw signature image bytes for `/api/reporting/signature/[id]`. */
export async function getSignatureBytes(
  signatureId: number,
): Promise<SignatureBytes | null> {
  if (!Number.isInteger(signatureId)) return null;

  const envelope = await cached<CachedSigEnvelope | null>(
    `telo:report:sig-bytes:${signatureId}`,
    60 * 60,
    () =>
      withRetry(async () => {
        const pool = await getPool();
        const r = await pool
          .request()
          .input('id', sql.Int, signatureId)
          .query<{ bytes: Buffer | null }>(`
            SELECT Signature AS bytes
            FROM dbo.tbl_med_signature_master
            WHERE id = @id AND Signature IS NOT NULL
          `);
        const row = r.recordset[0];
        if (!row?.bytes) return null;
        return { mime: sniffMime(row.bytes), bytesB64: row.bytes.toString('base64') };
      }),
  );
  if (!envelope) return null;
  return { mime: envelope.mime, bytes: Buffer.from(envelope.bytesB64, 'base64') };
}
