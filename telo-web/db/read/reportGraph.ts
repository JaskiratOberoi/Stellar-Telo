import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { concatPdfs } from '@/lib/report/mergePdfs';

/**
 * LIS graph attachments — TELO READ ONLY.
 *
 * Certain tests (Double/Quadruple Marker, allergy panels, cytogenetics, …) have
 * a graph/report PDF uploaded against the result in the legacy LIS. The lab
 * staff attach it via the worksheet "paperclip"; the LIS staples it to the
 * printed report. Telo surfaces the same file as a download beside the report.
 *
 * Source of truth: `dbo.tbl_med_mcc_patient_test_result_attachment`
 *   - `attachment` varbinary(MAX) — the file bytes (in practice always a PDF),
 *   - `vail_id`    nvarchar(50)   — the SID (vial id) the file belongs to,
 *   - `file_type`  varchar(50)    — the original extension (.pdf/.jpg/.png),
 *   - `result_id`  int            — FK → tbl_med_mcc_patient_test_result.id.
 *
 * A SID almost always has exactly one attachment (a handful have two). When a
 * SID has several PDFs we merge them into one document; a lone image is served
 * as-is (defensive — no images exist in the data today, but the column allows it).
 */

export interface GraphAttachmentMeta {
  id: number;
  fileType: string;
  testName: string | null;
}

/** %PDF magic. */
const isPdf = (b: Buffer) =>
  b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

/** Best-effort content type from magic bytes, falling back to the stored ext. */
function sniffMime(buf: Buffer, fileType: string): string {
  if (isPdf(buf)) return 'application/pdf';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'image/jpeg';
  const ext = (fileType || '').toLowerCase();
  if (ext.includes('png')) return 'image/png';
  if (ext.includes('jpg') || ext.includes('jpeg')) return 'image/jpeg';
  return 'application/pdf';
}

/**
 * Metadata (no bytes) for the graph attachments on a SID — cheap, for deciding
 * whether to show the "Download graph" button and how many there are.
 */
export async function listSidGraphs(sid: string): Promise<GraphAttachmentMeta[]> {
  const target = (sid ?? '').trim();
  if (!target) return [];
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('sid', sql.NVarChar(50), target)
      .query<{ id: number; fileType: string | null; testName: string | null }>(`
        SELECT a.id AS id, a.file_type AS fileType, r.testname AS testName
        FROM dbo.tbl_med_mcc_patient_test_result_attachment a
        LEFT JOIN dbo.tbl_med_mcc_patient_test_result r ON r.id = a.result_id
        WHERE a.vail_id = @sid AND a.attachment IS NOT NULL
        ORDER BY a.id
      `);
    return r.recordset.map((x) => ({
      id: x.id,
      fileType: (x.fileType ?? '').trim(),
      testName: x.testName?.trim() || null,
    }));
  });
}

/**
 * The SID's attached graph as one downloadable file. Several PDFs are merged
 * into a single document; a lone non-PDF is served as-is. Null when the SID has
 * no attachment.
 */
export async function getSidGraphFile(
  sid: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const target = (sid ?? '').trim();
  if (!target) return null;
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('sid', sql.NVarChar(50), target)
      .query<{ bytes: Buffer | null; fileType: string | null }>(`
        SELECT a.attachment AS bytes, a.file_type AS fileType
        FROM dbo.tbl_med_mcc_patient_test_result_attachment a
        WHERE a.vail_id = @sid AND a.attachment IS NOT NULL
        ORDER BY a.id
      `);
    const rows = r.recordset.filter(
      (x): x is { bytes: Buffer; fileType: string | null } => !!x.bytes,
    );
    if (rows.length === 0) return null;
    // Practically every attachment is a PDF. If all are PDFs, merge into one
    // document; otherwise serve the first file as-is.
    if (rows.every((x) => isPdf(x.bytes))) {
      const merged = await concatPdfs(rows.map((x) => new Uint8Array(x.bytes)));
      return { mime: 'application/pdf', bytes: Buffer.from(merged) };
    }
    const first = rows[0];
    return { mime: sniffMime(first.bytes, first.fileType ?? ''), bytes: first.bytes };
  });
}
