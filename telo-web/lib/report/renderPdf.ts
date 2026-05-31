import 'server-only';
import puppeteer from 'puppeteer';

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
export async function renderFragmentToPdf(
  path: string,
  cookieHeader: string | null,
): Promise<Uint8Array> {
  const base = process.env.REPORT_RENDER_BASE_URL ?? 'http://127.0.0.1:3000';
  const target = new URL(path, base);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();

    if (cookieHeader) {
      const cookies = cookieHeader
        .split(';')
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => {
          const eq = c.indexOf('=');
          const name = eq === -1 ? c : c.slice(0, eq);
          const value = eq === -1 ? '' : c.slice(eq + 1);
          return { name: name.trim(), value, domain: target.hostname, path: '/' };
        })
        .filter((c) => c.name);
      if (cookies.length) await page.setCookie(...cookies);
    }

    await page.goto(target.toString(), {
      waitUntil: 'networkidle2',
      timeout: 45_000,
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
