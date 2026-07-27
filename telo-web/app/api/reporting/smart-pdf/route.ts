import { NextResponse } from 'next/server';
import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { canAccessSidReport } from '@/lib/reportScope';
import { isSidReportLocked } from '@/lib/reportLock';
import { renderFragmentToPdf } from '@/lib/report/renderPdf';
import { mergeOntoLetterhead } from '@/lib/report/letterheadPdf';
import { reportToken } from '@/lib/report/reportLink';
import { buildReportFilename } from '@/lib/report/reportFilename';

export const dynamic = 'force-dynamic';
// Headless Chromium needs the Node runtime (not Edge).
export const runtime = 'nodejs';
// PDF render + merge can take a few seconds.
export const maxDuration = 60;

/**
 * Generates the patient-friendly Smart Report PDF for a SID. Same guard block as
 * the default report route (/api/reporting/pdf) — capability, client scope,
 * balance lock, per-report HMAC token for the headless render — but renders the
 * `/print/reporting/[sid]/smart` fragment and merges in HEADLESS mode: the Smart
 * Report draws its own branded header/footer, so it prints without the Noble
 * letterhead. Filename gets a `_Smart` suffix to distinguish it from the
 * clinical report.
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
  let date: unknown;
  let patientName: unknown;
  let profileName: unknown;
  try {
    ({ sid, date, patientName, profileName } = await req.json());
  } catch {
    return new NextResponse('Bad request', { status: 400 });
  }
  if (typeof sid !== 'string' || !sid.trim()) {
    return new NextResponse('Missing sid', { status: 400 });
  }
  if (!(await canAccessSidReport(user, sid.trim()))) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const lock = await isSidReportLocked(sid.trim());
  if (lock.locked) {
    return NextResponse.json(
      { error: 'BALANCE_LOCKED', reason: lock.reason, dueAmount: lock.dueAmount },
      { status: 423 },
    );
  }
  const dateHint = typeof date === 'string' && date.trim() ? date.trim() : '';

  // PatientName_SID_ProfileName_Smart.pdf — the _Smart suffix keeps it distinct
  // from the clinical report's download for the same sample.
  const base = buildReportFilename({
    patientName: typeof patientName === 'string' ? patientName : null,
    sid: sid.trim(),
    profileName: typeof profileName === 'string' ? profileName : null,
  }).replace(/\.pdf$/i, '');
  const fileName = `${base}_Smart.pdf`;

  // Auth for the headless render rides on a per-report HMAC token, not cookies
  // (the prod session cookie is `__Secure-`-prefixed and won't set on the
  // http://127.0.0.1 render origin). Pre-scoped: every check above has passed.
  const token = reportToken(sid.trim());
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const fragmentPath = `/print/reporting/${encodeURIComponent(sid.trim())}/smart?pdf=1${
    dateHint ? `&date=${encodeURIComponent(dateHint)}` : ''
  }${tokenParam}`;

  try {
    const content = await renderFragmentToPdf(fragmentPath, null);
    // Always headless: the Smart Report is self-branded, no Noble letterhead.
    // No page-number stamp — it's a consumer booklet with a full-bleed cover.
    const merged = await mergeOntoLetterhead(content, { headless: true, pageNumbers: false });

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
