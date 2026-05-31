'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Prints the lab or bill receipt by loading a server-rendered fragment route
 * (/print/orders/[id]/[kind]) into an off-screen iframe and calling `print()`
 * on the iframe window once images settle.
 *
 *  - The fragment route avoids SSRing both invoice templates inside every
 *    order page visit — print HTML cost is paid only when the user clicks.
 *  - The iframe's <title> is what Chrome uses as the default PDF filename
 *    when the user picks "Save as PDF" — Chrome uses the document title at
 *    `print()` time, so we set it on the iframe document after load.
 *  - The URL shown in Chrome's print header is the iframe's own
 *    `/print/orders/...` URL, not the parent's `/orders/24173?back=...`,
 *    which keeps internal query params off printed bills.
 *  - We wait for the iframe `load` event AND for every `<img>` in the
 *    iframe's body to either complete or error out, then issue a small
 *    settle delay so linked stylesheets finish fetching too. This closes
 *    the race that previously forced the bill logo to be inlined as a
 *    base64 data URI — Chrome no longer snapshots an empty image slot.
 */

const PRINT_SETTLE_MS = 150;
const IMAGE_WAIT_TIMEOUT_MS = 4_000;
const POST_PRINT_CLEANUP_MS = 5_000;
const LOAD_TIMEOUT_MS = 30_000;

function removeIframe(iframe: HTMLIFrameElement) {
  if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
}

function scheduleIframeCleanup(iframe: HTMLIFrameElement) {
  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    removeIframe(iframe);
  };
  const win = iframe.contentWindow;
  if (win) {
    win.addEventListener('afterprint', cleanup, { once: true });
  }
  // Some browsers (notably Chrome "Save as PDF") fire afterprint on the
  // opener/parent window rather than the iframe — listen on both.
  window.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(cleanup, POST_PRINT_CLEANUP_MS);
}

function printFragment(
  fragmentUrl: string,
  htmlClass: 'print-bill' | 'print-lab',
  title: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
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
    iframe.src = fragmentUrl;
    document.body.appendChild(iframe);

    let settled = false;
    const finishOk = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(loadTimeout);
      resolve();
    };
    const finishErr = (err: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(loadTimeout);
      removeIframe(iframe);
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const loadTimeout = window.setTimeout(() => {
      console.error('print fragment load timed out');
      finishErr(new Error('Print timed out'));
    }, LOAD_TIMEOUT_MS);

    iframe.addEventListener(
      'load',
      () => {
        void (async () => {
          try {
            const doc = iframe.contentDocument;
            if (doc) {
              // The fragment page renders inside the root layout (<html class="dark">).
              // Tag it with the print-bill/print-lab class so the @media print rules
              // in globals.css apply identically to the legacy in-page print flow.
              doc.documentElement.classList.add(htmlClass);
              // Chrome uses the document title as the default PDF filename.
              doc.title = title;
            }

            // Wait for every image in the fragment to settle before printing —
            // without this Chrome snapshots the preview before the bill logo
            // finishes loading and the print comes out missing the image. The
            // server already serves it with ETag caching, so repeat prints are
            // instant from the browser cache.
            await waitForImagesToSettle(iframe);
            await new Promise<void>((r) =>
              window.setTimeout(r, PRINT_SETTLE_MS),
            );

            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();

            // Resolve as soon as the dialog opens so the button label resets.
            // Keep the iframe alive until afterprint — removing it early blanks
            // the print preview. afterprint is unreliable on iframe windows when
            // the user picks "Save as PDF", so scheduleIframeCleanup also
            // listens on the parent window and falls back to a timeout.
            finishOk();
            scheduleIframeCleanup(iframe);
          } catch (err) {
            console.error('print fragment prepare failed', err);
            finishErr(err);
          }
        })();
      },
      { once: true },
    );
    iframe.addEventListener(
      'error',
      () => {
        console.error('print fragment failed to load');
        finishErr(new Error('Print fragment failed to load'));
      },
      { once: true },
    );
  });
}

/**
 * Resolves once every <img> in the iframe document has either loaded or
 * errored (404, blocked, etc.). Capped by IMAGE_WAIT_TIMEOUT_MS so a single
 * stuck request can't hang the print dialog forever — at the timeout we
 * proceed with print anyway and let the browser render whatever it has.
 */
function waitForImagesToSettle(iframe: HTMLIFrameElement): Promise<void> {
  const doc = iframe.contentDocument;
  if (!doc) return Promise.resolve();
  const imgs = Array.from(doc.images);
  if (imgs.length === 0) return Promise.resolve();

  const settle = Promise.all(
    imgs.map((img) => {
      // `complete` is true for cached images already; `naturalWidth` filters
      // out cached 404s where the request "completed" but no pixels exist.
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
    }),
  ).then(() => undefined);

  const timeout = new Promise<void>((resolve) =>
    window.setTimeout(resolve, IMAGE_WAIT_TIMEOUT_MS),
  );
  return Promise.race([settle, timeout]);
}

interface PrintProps {
  /** Numeric bill id used in the print fragment route. */
  billId: number;
  /**
   * Human-readable bill number used as the PDF filename. Pass `order.billNumber
   * ?? order.billId` so we always have something — the billId numeric is a
   * fine fallback when bill_number hasn't been assigned yet.
   */
  billNumber: number | null;
}

export function PrintLabButton({ billId, billNumber }: PrintProps) {
  const [printing, setPrinting] = useState(false);
  const title = billNumber != null ? `Lab-${billNumber}` : 'Lab';
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={printing}
      className="gap-1.5"
      onClick={async () => {
        setPrinting(true);
        try {
          await printFragment(
            `/print/orders/${billId}/lab`,
            'print-lab',
            title,
          );
        } finally {
          setPrinting(false);
        }
      }}
    >
      <Printer className="h-3.5 w-3.5" />
      {printing ? 'Preparing…' : 'Lab receipt'}
    </Button>
  );
}

export function PrintBillButton({ billId, billNumber }: PrintProps) {
  const [printing, setPrinting] = useState(false);
  const title = billNumber != null ? `Bill-${billNumber}` : 'Bill';
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={printing}
      className="gap-1.5"
      onClick={async () => {
        setPrinting(true);
        try {
          await printFragment(
            `/print/orders/${billId}/bill`,
            'print-bill',
            title,
          );
        } finally {
          setPrinting(false);
        }
      }}
    >
      <Printer className="h-3.5 w-3.5" />
      {printing ? 'Preparing…' : 'Bill'}
    </Button>
  );
}
