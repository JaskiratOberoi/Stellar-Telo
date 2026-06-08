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

/** A report signatory with its signature image already inlined as a data-URI. */
export interface InlineSigner {
  id: number;
  doctorName: string | null;
  designation: string | null;
  signatureDataUrl: string | null;
}

/**
 * LIS-faithful fallback signatories. When a report's business unit has no
 * signatories of its own (tbl_med_signature_master has no usable rows for it),
 * the LIS report SP (GET_PATIENT_REPORT_VAIL_ID) falls back to the
 * `Department_View_Sign` view — which gives each department its default PRIMARY
 * (Expr1/Expr2/Expr3) and SECONDARY (Doctorname/Designation/Signature) doctor +
 * signature image (the head-office signatories). We read the SAME view,
 * restricted to the report's departments, so e.g. a Microbiology report gets
 * Dr KD Gandhi while Biochemistry/Serology get Dr Jasneet Kaur — exactly as the
 * LIS export does. Returns up to 3 distinct signers (primaries then secondaries)
 * with the image inlined (so it renders on the public/token softcopy too).
 */
export async function getDefaultSigners(
  departmentNames: string[],
): Promise<InlineSigner[]> {
  const names = [...new Set(departmentNames.map((d) => d.trim()).filter(Boolean))];
  if (names.length === 0) return [];
  const key = `telo:report:default-signers:${names
    .map((n) => n.toLowerCase())
    .sort()
    .join('|')}`;
  return cached<InlineSigner[]>(key, 60 * 60, () =>
    withRetry(async () => {
      const pool = await getPool();
      const req = pool.request();
      const params = names.map((n, i) => {
        req.input(`d${i}`, sql.NVarChar(200), n);
        return `@d${i}`;
      });
      const r = await req.query<{
        pName: string | null;
        pDesig: string | null;
        pSig: Buffer | null;
        sName: string | null;
        sDesig: string | null;
        sSig: Buffer | null;
      }>(`
        SELECT Expr1 AS pName, Expr2 AS pDesig, Expr3 AS pSig,
               Doctorname AS sName, Designation AS sDesig, Signature AS sSig
        FROM dbo.Department_View_Sign
        WHERE Name IN (${params.join(',')})
      `);
      const out: InlineSigner[] = [];
      const seen = new Set<string>();
      let synthId = -1;
      const add = (name: string | null, desig: string | null, sig: Buffer | null) => {
        const nm = (name ?? '').trim();
        const k = nm.toLowerCase();
        if (!nm || !sig || sig.length === 0 || seen.has(k)) return;
        seen.add(k);
        out.push({
          id: synthId--,
          doctorName: nm,
          designation: desig?.trim() || null,
          signatureDataUrl: `data:${sniffMime(sig)};base64,${sig.toString('base64')}`,
        });
      };
      // Primary signatories first (left of the QR), then secondary (right) —
      // mirrors the DOC_TYPE 1 → 2 ordering used for configured signers.
      for (const x of r.recordset) add(x.pName, x.pDesig, x.pSig);
      for (const x of r.recordset) add(x.sName, x.sDesig, x.sSig);
      return out.slice(0, 3);
    }),
  );
}
