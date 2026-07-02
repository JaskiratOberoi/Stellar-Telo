import { NextResponse } from 'next/server';
import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { canAccessSidReport, reportClientCodeScope } from '@/lib/reportScope';
import { isSidReportLocked } from '@/lib/reportLock';
import { renderFragmentsToPdfs } from '@/lib/report/renderPdf';
import { mergeOntoLetterhead } from '@/lib/report/letterheadPdf';
import { concatPdfs } from '@/lib/report/mergePdfs';

export const dynamic = 'force-dynamic';
// Headless Chromium needs the Node runtime (not Edge).
export const runtime = 'nodejs';
// Render (one browser, pooled) + per-report letterhead + concat. The MAX_ITEMS
// cap keeps a batch within this budget at concurrency 3.
export const maxDuration = 60;

/** Hard cap on reports per bulk request — also enforced in the UI. Keep in
 *  sync with the client constant in components/reporting/reporting-view.tsx. */
const MAX_ITEMS = 25;

interface BulkItem {
  sid: string;
  panel?: string;
  date?: string;
  patientName?: string;
}

function fragmentPath(item: BulkItem): string {
  const panelId = typeof item.panel === 'string' && item.panel.trim() ? item.panel.trim() : '';
  const dateHint = typeof item.date === 'string' && item.date.trim() ? item.date.trim() : '';
  // Whole report for bulk (no per-test exclude), but ALWAYS split-by-department
  // — that is the canonical report layout (one profile/commentary-test per page
  // with the signature/QR footer pinned to the page bottom). It matches the
  // single-report download, whose preview defaults `split = true`. Omitting it
  // falls back to the continuous thead/tfoot mode where signatures ride up.
  return `/print/reporting/${encodeURIComponent(item.sid.trim())}?pdf=1&split=1${
    panelId ? `&panel=${encodeURIComponent(panelId)}` : ''
  }${dateHint ? `&date=${encodeURIComponent(dateHint)}` : ''}`;
}

/**
 * Bulk variant of /api/reporting/pdf: renders several reports and returns ONE
 * merged PDF (each report on its own Noble letterhead pages). Gated to
 * `report:view` (client-scoped roles are restricted to their own SIDs), same
 * as the single route.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!hasCapability(user.caps, 'report:view')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  let rawItems: unknown;
  try {
    ({ items: rawItems } = await req.json());
  } catch {
    return new NextResponse('Bad request', { status: 400 });
  }
  if (!Array.isArray(rawItems)) {
    return new NextResponse('Missing items', { status: 400 });
  }

  // Keep only well-formed entries with a non-empty SID, preserving order.
  const parsedItems: BulkItem[] = rawItems
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({
      sid: typeof x.sid === 'string' ? x.sid.trim() : '',
      panel: typeof x.panel === 'string' ? x.panel : undefined,
      date: typeof x.date === 'string' ? x.date : undefined,
      patientName: typeof x.patientName === 'string' ? x.patientName : undefined,
    }))
    .filter((x) => x.sid.length > 0);

  // Client-facing reporters: drop any SID outside their own client scope so a
  // bulk request can never bundle another client's reports. Unrestricted roles
  // (super_admin/admin) keep every requested SID.
  const scopeCodes = await reportClientCodeScope(user);
  let items = parsedItems;
  if (scopeCodes !== null) {
    const inScope = await Promise.all(
      parsedItems.map((it) => canAccessSidReport(user, it.sid)),
    );
    items = parsedItems.filter((_, i) => inScope[i]);
  }

  // Balance lock (Telo-only, all roles): drop any SID whose patient bill /
  // client wallet has an outstanding balance — a bulk print can't smuggle a
  // balance-locked report through.
  const lockStates = await Promise.all(
    items.map((it) => isSidReportLocked(it.sid)),
  );
  const lockedCount = lockStates.filter((l) => l.locked).length;
  items = items.filter((_, i) => !lockStates[i].locked);

  if (items.length === 0) {
    return new NextResponse(
      lockedCount > 0
        ? 'All selected reports are on hold for an outstanding balance.'
        : 'No valid reports selected',
      { status: lockedCount > 0 ? 423 : 400 },
    );
  }
  if (items.length > MAX_ITEMS) {
    return new NextResponse(
      `Too many reports — select at most ${MAX_ITEMS}.`,
      { status: 400 },
    );
  }

  const stamp = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
  const fileName = `Reports_${items.length}_${stamp}.pdf`;

  try {
    const contents = await renderFragmentsToPdfs(
      items.map(fragmentPath),
      req.headers.get('cookie'),
    );
    // Stamp each onto the letterhead, then concatenate into one document.
    const letterheaded = await Promise.all(
      contents.map((c) => mergeOntoLetterhead(c)),
    );
    const merged = await concatPdfs(letterheaded);

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
