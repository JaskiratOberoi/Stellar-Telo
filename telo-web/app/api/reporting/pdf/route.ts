import { NextResponse } from 'next/server';
import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { canAccessSidReport } from '@/lib/reportScope';
import { renderFragmentToPdf } from '@/lib/report/renderPdf';
import { mergeOntoLetterhead } from '@/lib/report/letterheadPdf';

export const dynamic = 'force-dynamic';
// Headless Chromium needs the Node runtime (not Edge).
export const runtime = 'nodejs';
// PDF render + merge can take a few seconds.
export const maxDuration = 60;

/**
 * Generates the TSH report PDF for a SID on the Noble letterhead:
 *   1. headless Chromium renders /print/reporting/[sid]?pdf=1 (content only),
 *   2. pdf-lib stamps it onto the letterhead.
 * Gated to `report:view`; a client-scoped role (client_reporting) can only
 * render its own client's SIDs — see canAccessSidReport below.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!hasCapability(user.caps, 'report:view')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  let sid: unknown;
  let panel: unknown;
  let date: unknown;
  let patientName: unknown;
  let split: unknown;
  let exclude: unknown;
  let headless: unknown;
  try {
    ({ sid, panel, date, patientName, split, exclude, headless } = await req.json());
  } catch {
    return new NextResponse('Bad request', { status: 400 });
  }
  if (typeof sid !== 'string' || !sid.trim()) {
    return new NextResponse('Missing sid', { status: 400 });
  }
  // Client-facing reporters may only render their own client's reports. This
  // also guards the token minted below (fragmentPath) — an out-of-scope SID
  // never gets a valid per-report token.
  if (!(await canAccessSidReport(user, sid.trim()))) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const panelId = typeof panel === 'string' && panel.trim() ? panel.trim() : '';
  const dateHint = typeof date === 'string' && date.trim() ? date.trim() : '';
  const splitParam = split === true || split === '1' || split === 'true' ? '&split=1' : '';
  // Headless = no Noble letterhead background; for printing onto pre-printed paper.
  const headlessReport = headless === true || headless === '1' || headless === 'true';
  // Tests/parameters the user unticked in the preview — dropped from the PDF.
  const excludeList = Array.isArray(exclude)
    ? exclude.filter(
        (s): s is string =>
          typeof s === 'string' && /^\d+:\d+(?::\d+){0,2}$/.test(s),
      )
    : [];
  const excludeParam = excludeList.length
    ? `&exclude=${encodeURIComponent(excludeList.join(','))}`
    : '';
  // Filename = patient name + SID (never the test name).
  const safeName =
    (typeof patientName === 'string' ? patientName : '')
      .replace(/[^\w]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Report';
  const fileName = `${safeName}_${sid.trim()}.pdf`;

  const fragmentPath = `/print/reporting/${encodeURIComponent(sid.trim())}?pdf=1${
    panelId ? `&panel=${encodeURIComponent(panelId)}` : ''
  }${dateHint ? `&date=${encodeURIComponent(dateHint)}` : ''}${splitParam}${excludeParam}`;

  try {
    const content = await renderFragmentToPdf(
      fragmentPath,
      req.headers.get('cookie'),
    );
    const merged = await mergeOntoLetterhead(content, { headless: headlessReport });

    return new NextResponse(new Uint8Array(merged), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(`PDF generation failed: ${msg}`, { status: 500 });
  }
}
