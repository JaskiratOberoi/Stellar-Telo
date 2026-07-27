import { NextResponse } from 'next/server';
import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { canAccessSidReport, reportClientCodeScope } from '@/lib/reportScope';
import { isSidReportLocked } from '@/lib/reportLock';
import { audit } from '@/lib/audit';
import { renderFragmentsToPdfs } from '@/lib/report/renderPdf';
import { mergeOntoLetterhead } from '@/lib/report/letterheadPdf';
import { appendAttachment, concatPdfs } from '@/lib/report/mergePdfs';
import { reportToken } from '@/lib/report/reportLink';
import { getSidGraphFile } from '@/db/read/reportGraph';

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
  // Auth via per-report HMAC token, not cookie replay — the `__Secure-` prod
  // session cookie can't be set on the http loopback origin the headless render
  // loads. Each SID here has already cleared scope + balance-lock checks below.
  const token = reportToken(item.sid.trim());
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  return `/print/reporting/${encodeURIComponent(item.sid.trim())}?pdf=1&split=1${
    panelId ? `&panel=${encodeURIComponent(panelId)}` : ''
  }${dateHint ? `&date=${encodeURIComponent(dateHint)}` : ''}${tokenParam}`;
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
  let rawWithGraph: unknown;
  try {
    ({ items: rawItems, withGraph: rawWithGraph } = await req.json());
  } catch {
    return new NextResponse('Bad request', { status: 400 });
  }
  const withGraph =
    rawWithGraph === true || rawWithGraph === '1' || rawWithGraph === 'true';
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
  // Every gate passed for this final set — audit the bulk pull (SID list
  // truncated to keep the details payload bounded).
  audit({
    kind: 'report.pdf_bulk',
    actor: user.uid,
    count: items.length,
    sids: items.map((it) => it.sid).join(',').slice(0, 400),
  });

  const stamp = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
  const fileName = `Reports_${items.length}_${stamp}.pdf`;

  try {
    // Auth rides on the per-report token in each fragmentPath, NOT cookies —
    // pass null so headless Chromium never tries to set the caller's
    // `__Secure-`/`__Host-`-prefixed prod cookies on the http://127.0.0.1 render
    // origin (which throws "Invalid cookie fields" and fails the render).
    const contents = await renderFragmentsToPdfs(
      items.map(fragmentPath),
      null,
    );
    // Stamp each onto the letterhead — then, with "Include graphs" on, staple
    // each report's LIS graph attachment right after its own pages (SIDs
    // without an attachment pass through unchanged) — and concatenate into one
    // document.
    const letterheaded = await Promise.all(
      contents.map(async (c, i) => {
        const pdf: Uint8Array = await mergeOntoLetterhead(c);
        if (!withGraph) return pdf;
        const graph = await getSidGraphFile(items[i].sid);
        return graph
          ? appendAttachment(pdf, {
              mime: graph.mime,
              bytes: new Uint8Array(graph.bytes),
            })
          : pdf;
      }),
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
