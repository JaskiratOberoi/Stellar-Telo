import 'server-only';
import { readFile } from 'fs/promises';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
  // Headless mode: skip the Noble letterhead background entirely, leaving the
  // header/footer bands blank so the PDF can be printed onto physical pre-printed
  // letterhead paper. The content keeps its full margins (26mm top / 34mm bottom)
  // so it still lines up under the printed letterhead, and page numbering stays.
  // pageNumberY overrides the vertical position of the "Page X of Y" stamp (in
  // points from the page bottom) — the Smart Report uses smaller margins and
  // needs the stamp lower, in its own clear bottom band. pageNumbers:false skips
  // the stamp entirely (the Smart Report is a consumer booklet with a full-bleed
  // cover — a "Page 1 of N" over the cover art would look wrong).
  options: { headless?: boolean; pageNumberY?: number; pageNumbers?: boolean } = {},
): Promise<Uint8Array> {
  const headless = options.headless === true;
  const pageNumberY = options.pageNumberY ?? 99;
  const pageNumbers = options.pageNumbers !== false;

  const out = await PDFDocument.create();
  const content = await PDFDocument.load(contentPdf);

  let lhCount = 0;
  let lhEmbedded: Awaited<ReturnType<PDFDocument['embedPage']>>[] = [];
  if (!headless) {
    const letterheadBytes = await loadLetterhead();
    const letterhead = await PDFDocument.load(letterheadBytes, {
      ignoreEncryption: true,
    });
    lhCount = letterhead.getPageCount();
    // Embed each letterhead page once; reuse across content pages.
    lhEmbedded = await Promise.all(
      letterhead.getPages().map((p) => out.embedPage(p)),
    );
  }

  // Font for the "Page X of Y" stamp (NABL requirement — every page numbered).
  const font = await out.embedFont(StandardFonts.Helvetica);

  const contentPages = content.getPages();
  const total = contentPages.length;
  for (let i = 0; i < contentPages.length; i++) {
    const src = contentPages[i];
    const { width, height } = src.getSize();
    const page = out.addPage([width, height]);

    // Background: primary letterhead for page 0, continuation for the rest.
    // Skipped entirely in headless mode (pre-printed letterhead paper).
    const lhIndex = i === 0 ? 0 : Math.min(1, lhCount - 1);
    const bg = headless ? undefined : lhEmbedded[lhIndex];
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

    if (!pageNumbers) continue;

    // "Page X of Y" — right-aligned on the report's last footer line (the NOTE
    // line), level with it rather than on a separate line below. The repeating
    // <tfoot> bottoms out at the content-box bottom (34mm ≈ 96pt), so the NOTE
    // baseline sits at ~99pt from the page bottom on every page; we match that y
    // and align the right edge to the 14mm content margin. Drawn last (on top).
    const label = `Page ${i + 1} of ${total}`;
    const size = 8;
    const textWidth = font.widthOfTextAtSize(label, size);
    const rightMargin = (14 / 25.4) * 72; // 14mm content margin, in points
    page.drawText(label, {
      x: width - rightMargin - textWidth,
      y: pageNumberY,
      size,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
  }

  return out.save();
}
