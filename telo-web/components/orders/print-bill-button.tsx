'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Prints the lab or bill receipt by cloning the relevant
 * `[data-invoice="..."]` block into an off-screen iframe with `srcdoc`,
 * then calling `print()` on the iframe window. Two side benefits over the
 * previous `window.print()` on the order page:
 *
 *  - The iframe's <title> is what Chrome uses as the default PDF filename
 *    when the user picks "Save as PDF", so saved files now look like
 *    `Bill-26050012.pdf` / `Lab-26050012.pdf` instead of the order page
 *    title.
 *  - The URL shown in Chrome's print header (top-right by default) becomes
 *    `about:srcdoc` — the iframe's own URL — instead of the parent's long
 *    `/orders/24173?back=…` URL with query params. Users who want NO header
 *    at all can still uncheck "Headers and footers" in the print dialog,
 *    but the leak of internal URLs onto printed bills is fixed.
 *
 * Implementation notes:
 *  - Stylesheets and `<style>` tags from the parent are mirrored into the
 *    iframe head so Tailwind classes resolve identically.
 *  - A `<base href>` is injected so relative URLs (e.g. `/branding/noble-
 *    logo.png`) still resolve. The custom logo is already a `data:` URI
 *    embedded in the markup so it needs no base.
 *  - We wait for the iframe `load` event plus a brief settle delay so
 *    linked stylesheets finish fetching before the print snapshot.
 */

const PRINT_SETTLE_MS = 300;
const POST_PRINT_CLEANUP_MS = 5_000;

function buildPrintDocument(
  bodyHtml: string,
  htmlClass: 'print-bill' | 'print-lab',
  title: string,
): string {
  const styleLinks = Array.from(
    document.querySelectorAll('link[rel="stylesheet"]'),
  )
    .map((el) => el.outerHTML)
    .join('\n');
  const inlineStyles = Array.from(document.querySelectorAll('style'))
    .map((el) => el.outerHTML)
    .join('\n');
  const baseHref = `${window.location.origin}/`;

  // The <html> class triggers the @media print rules in globals.css that
  // show the right invoice block. Since we only copied one block into the
  // body it would render even without the class, but keeping the class
  // matches existing print CSS expectations exactly.
  return `<!doctype html>
<html class="${htmlClass}">
  <head>
    <meta charset="utf-8">
    <base href="${baseHref}">
    <title>${escapeHtml(title)}</title>
    ${styleLinks}
    ${inlineStyles}
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function printBlock(
  selector: string,
  htmlClass: 'print-bill' | 'print-lab',
  title: string,
) {
  const block = document.querySelector(selector);
  if (!block) {
    // Defensive fallback: nothing to copy, fall back to the legacy in-page
    // print flow (slightly worse UX — leaks URL — but the user still gets
    // a printable page).
    document.documentElement.classList.add(htmlClass);
    window.print();
    document.documentElement.classList.remove(htmlClass);
    return;
  }

  const srcdoc = buildPrintDocument(block.outerHTML, htmlClass, title);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden',
  } as CSSStyleDeclaration);
  iframe.srcdoc = srcdoc;
  document.body.appendChild(iframe);

  const cleanup = () => {
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  };

  iframe.addEventListener(
    'load',
    () => {
      window.setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (err) {
          console.error('print failed', err);
          cleanup();
          return;
        }
        const win = iframe.contentWindow;
        if (win) {
          win.addEventListener('afterprint', cleanup, { once: true });
        }
        window.setTimeout(cleanup, POST_PRINT_CLEANUP_MS);
      }, PRINT_SETTLE_MS);
    },
    { once: true },
  );
}

interface PrintProps {
  /**
   * Human-readable bill number used as the PDF filename. Pass `order.billNumber
   * ?? order.billId` so we always have something — the billId numeric is a
   * fine fallback when bill_number hasn't been assigned yet.
   */
  billNumber: number | null;
}

export function PrintLabButton({ billNumber }: PrintProps) {
  const title = billNumber != null ? `Lab-${billNumber}` : 'Lab';
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => printBlock('[data-invoice="lab"]', 'print-lab', title)}
    >
      <Printer className="h-3.5 w-3.5" />
      Lab receipt
    </Button>
  );
}

export function PrintBillButton({ billNumber }: PrintProps) {
  const title = billNumber != null ? `Bill-${billNumber}` : 'Bill';
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => printBlock('[data-invoice="bill"]', 'print-bill', title)}
    >
      <Printer className="h-3.5 w-3.5" />
      Bill
    </Button>
  );
}
