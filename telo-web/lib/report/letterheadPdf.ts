import 'server-only';
import { readFile } from 'fs/promises';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

/**
 * Composites a content-only PDF (from headless Chromium) onto the Noble
 * letterhead. For each content page we create an A4 page, draw the letterhead
 * page full-bleed as the background, then stamp the content page on top —
 * keeping the letterhead crisp/vector. Page 0 of the letterhead is the primary
 * sheet; page 1 (if present) is used for any continuation pages.
 */

const LETTERHEAD_PATH = path.join(
  process.cwd(),
  'report-assets',
  'letterhead.pdf',
);

let cachedLetterhead: Buffer | null = null;

async function loadLetterhead(): Promise<Buffer> {
  if (!cachedLetterhead) {
    cachedLetterhead = await readFile(LETTERHEAD_PATH);
  }
  return cachedLetterhead;
}

export async function mergeOntoLetterhead(
  contentPdf: Uint8Array,
): Promise<Uint8Array> {
  const letterheadBytes = await loadLetterhead();

  const out = await PDFDocument.create();
  const content = await PDFDocument.load(contentPdf);
  const letterhead = await PDFDocument.load(letterheadBytes, {
    ignoreEncryption: true,
  });

  const lhCount = letterhead.getPageCount();
  // Embed each letterhead page once; reuse across content pages.
  const lhEmbedded = await Promise.all(
    letterhead.getPages().map((p) => out.embedPage(p)),
  );

  const contentPages = content.getPages();
  for (let i = 0; i < contentPages.length; i++) {
    const src = contentPages[i];
    const { width, height } = src.getSize();
    const page = out.addPage([width, height]);

    // Background: primary letterhead for page 0, continuation for the rest.
    const lhIndex = i === 0 ? 0 : Math.min(1, lhCount - 1);
    const bg = lhEmbedded[lhIndex];
    if (bg) {
      page.drawPage(bg, {
        x: 0,
        y: 0,
        width,
        height,
      });
    }

    // Foreground: the rendered report content.
    const fg = await out.embedPage(src);
    page.drawPage(fg, { x: 0, y: 0, width, height });
  }

  return out.save();
}
