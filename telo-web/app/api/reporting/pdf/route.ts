import { NextResponse } from 'next/server';
import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { canAccessSidReport } from '@/lib/reportScope';
import { isSidReportLocked } from '@/lib/reportLock';
import { renderFragmentToPdf } from '@/lib/report/renderPdf';
import { mergeOntoLetterhead } from '@/lib/report/letterheadPdf';
import { appendAttachment } from '@/lib/report/mergePdfs';
import { reportToken } from '@/lib/report/reportLink';
import { buildReportFilename } from '@/lib/report/reportFilename';
import { getSidGraphFile } from '@/db/read/reportGraph';

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
  let profileName: unknown;
  let split: unknown;
  let exclude: unknown;
  let headless: unknown;
  let withGraph: unknown;
  try {
    ({ sid, panel, date, patientName, profileName, split, exclude, headless, withGraph } =
      await req.json());
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
  // Balance lock (Telo-only): no report while the patient's bill / client wallet
  // has an outstanding balance. 423 Locked so the UI can show the pop-up.
  const lock = await isSidReportLocked(sid.trim());
  if (lock.locked) {
    return NextResponse.json(
      { error: 'BALANCE_LOCKED', reason: lock.reason, dueAmount: lock.dueAmount },
      { status: 423 },
    );
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
  // Filename = PatientName_SID_ProfileName (profile omitted when no filter is
  // active). Shared with the preview modal + one-report bulk download so every
  // single-report path saves an identically-named file.
  const fileName = buildReportFilename({
    patientName: typeof patientName === 'string' ? patientName : null,
    sid: sid.trim(),
    profileName: typeof profileName === 'string' ? profileName : null,
  });

  // Auth for the headless render goes via a per-report HMAC token, NOT cookie
  // replay: in a TLS prod deploy the session cookie is `__Secure-`-prefixed and
  // Chromium refuses to set it on the http://127.0.0.1 loopback origin the
  // renderer loads, so cookie-based auth silently fails and the fragment renders
  // the login page. The token path is pre-scoped — every check above (capability,
  // client scope, balance lock) has already passed for this exact SID.
  const token = reportToken(sid.trim());
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const fragmentPath = `/print/reporting/${encodeURIComponent(sid.trim())}?pdf=1${
    panelId ? `&panel=${encodeURIComponent(panelId)}` : ''
  }${dateHint ? `&date=${encodeURIComponent(dateHint)}` : ''}${splitParam}${excludeParam}${tokenParam}`;

  try {
    // Auth rides on the per-report token in fragmentPath, NOT cookies. We pass
    // null so headless Chromium never tries to set the caller's cookies: the
    // prod session/CSRF cookies are `__Secure-`/`__Host-`-prefixed and setting
    // them on the http://127.0.0.1 render origin throws "Invalid cookie fields",
    // failing the whole render. (The public /r/ softcopy route does the same.)
    const content = await renderFragmentToPdf(fragmentPath, null);
    let merged: Uint8Array = await mergeOntoLetterhead(content, {
      headless: headlessReport,
    });
    // "+ Graph": staple the LIS graph attachment (Double/Quadruple Marker,
    // allergy panels, …) after the report pages, like the LIS printed report.
    // No attachment on the SID → the plain report, silently.
    if (withGraph === true || withGraph === '1' || withGraph === 'true') {
      const graph = await getSidGraphFile(sid.trim());
      if (graph) {
        merged = await appendAttachment(merged, {
          mime: graph.mime,
          bytes: new Uint8Array(graph.bytes),
        });
      }
    }

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
