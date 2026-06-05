import 'server-only';
import puppeteer, { type Browser, type Page } from 'puppeteer';

/**
 * Render an internal print-fragment URL to a content-only PDF with headless
 * Chromium. The caller's cookies are forwarded so the fragment's session guard
 * (`report:view`) passes — Chromium loads the page exactly as the signed-in
 * user would, so SSR auth + Tailwind + the signature-image route all work with
 * no duplicate layout code.
 *
 * Auth note: we navigate to the loopback origin (REPORT_RENDER_BASE_URL,
 * default http://127.0.0.1:3000) and replay the request cookies against the
 * 127.0.0.1 host. In dev the next-auth cookie is non-secure and this is exact.
 * In a TLS-terminating prod deploy, point REPORT_RENDER_BASE_URL at an origin
 * that receives the session cookie (or front it with an internal token).
 */

function renderBaseUrl(): string {
  return process.env.REPORT_RENDER_BASE_URL ?? 'http://127.0.0.1:3000';
}

function parseCookies(
  cookieHeader: string | null,
  domain: string,
): { name: string; value: string; domain: string; path: string }[] {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const eq = c.indexOf('=');
      const name = eq === -1 ? c : c.slice(0, eq);
      const value = eq === -1 ? '' : c.slice(eq + 1);
      return { name: name.trim(), value, domain, path: '/' };
    })
    .filter((c) => c.name);
}

/** Render one fragment path to a content-only PDF using an open browser. */
async function renderOne(
  browser: Browser,
  path: string,
  cookieHeader: string | null,
): Promise<Uint8Array> {
  const target = new URL(path, renderBaseUrl());
  let page: Page | null = null;
  try {
    page = await browser.newPage();
    const cookies = parseCookies(cookieHeader, target.hostname);
    if (cookies.length) await page.setCookie(...cookies);

    await page.goto(target.toString(), {
      waitUntil: 'networkidle2',
      timeout: 45_000,
    });

    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

const LAUNCH_OPTS = {
  headless: true as const,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
};

/** Render a single print-fragment URL to a content-only PDF. */
export async function renderFragmentToPdf(
  path: string,
  cookieHeader: string | null,
): Promise<Uint8Array> {
  const browser = await puppeteer.launch(LAUNCH_OPTS);
  try {
    return await renderOne(browser, path, cookieHeader);
  } finally {
    await browser.close();
  }
}

/**
 * Render many print-fragment URLs to content-only PDFs, reusing ONE browser
 * across all of them (a fresh launch per report is the dominant cost). Pages
 * render with a small concurrency cap; results preserve input order. Used by
 * the bulk-download route — see app/api/reporting/pdf/bulk/route.ts.
 */
export async function renderFragmentsToPdfs(
  paths: string[],
  cookieHeader: string | null,
  opts: { concurrency?: number } = {},
): Promise<Uint8Array[]> {
  if (paths.length === 0) return [];
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, paths.length));
  const out = new Array<Uint8Array>(paths.length);

  const browser = await puppeteer.launch(LAUNCH_OPTS);
  try {
    let next = 0;
    async function worker(): Promise<void> {
      for (;;) {
        const i = next++;
        if (i >= paths.length) return;
        out[i] = await renderOne(browser, paths[i], cookieHeader);
      }
    }
    await Promise.all(
      Array.from({ length: concurrency }, () => worker()),
    );
    return out;
  } finally {
    await browser.close();
  }
}
