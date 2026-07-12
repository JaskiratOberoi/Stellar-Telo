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

/**
 * Append a graph/attachment file to an already-rendered report PDF, so the
 * report + its LIS graph download as one document (the "withGraph" option on
 * the single and bulk PDF routes). A PDF attachment contributes its pages
 * as-is; an image (PNG/JPEG — defensive, the LIS data is practically all PDF)
 * is centred on its own A4 page.
 */
export async function appendAttachment(
  report: Uint8Array,
  extra: { mime: string; bytes: Uint8Array },
): Promise<Uint8Array> {
  const out = await PDFDocument.load(report, { ignoreEncryption: true });
  if (extra.mime === 'application/pdf') {
    const doc = await PDFDocument.load(extra.bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const p of pages) out.addPage(p);
  } else {
    const img =
      extra.mime === 'image/png'
        ? await out.embedPng(extra.bytes)
        : await out.embedJpg(extra.bytes);
    const page = out.addPage([595.28, 841.89]); // A4 portrait, points
    const margin = 36;
    const scale = Math.min(
      (page.getWidth() - margin * 2) / img.width,
      (page.getHeight() - margin * 2) / img.height,
      1,
    );
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, {
      x: (page.getWidth() - w) / 2,
      y: (page.getHeight() - h) / 2,
      width: w,
      height: h,
    });
  }
  return out.save();
}
