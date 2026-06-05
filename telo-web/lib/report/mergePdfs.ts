import 'server-only';
import { PDFDocument } from 'pdf-lib';

/**
 * Concatenate several already-rendered PDFs (each a complete report on the
 * Noble letterhead) into one document, in the given order. Each report keeps
 * its own "Page X of Y" stamping — correct for a multi-patient packet where the
 * pages belong to distinct reports.
 *
 * Used by the bulk-download route to bundle the selected reports into a single
 * merged PDF. Mirrors the pdf-lib usage in lib/report/letterheadPdf.ts.
 */
export async function concatPdfs(pdfs: Uint8Array[]): Promise<Uint8Array> {
  if (pdfs.length === 1) return pdfs[0];

  const out = await PDFDocument.create();
  for (const bytes of pdfs) {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return out.save();
}
