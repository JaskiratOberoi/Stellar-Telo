import { NextResponse } from 'next/server';
import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { canAccessSidReport } from '@/lib/reportScope';
import { isSidReportLocked } from '@/lib/reportLock';
import { listSidGraphs, getSidGraphFile } from '@/db/read/reportGraph';

export const dynamic = 'force-dynamic';
// pdf-lib merge + varbinary buffers need the Node runtime (not Edge).
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Serves the LIS graph attachment(s) for a SID — the same PDF the legacy LIS
 * staples to the report (Double/Quadruple Marker, allergy panels, cytogenetics,
 * …). Source: dbo.tbl_med_mcc_patient_test_result_attachment (keyed by vail_id).
 *
 *   GET /api/reporting/graph/[sid]          → the file (merged PDF), as a download
 *   GET /api/reporting/graph/[sid]?meta=1   → { count, tests } for button visibility
 *
 * Gated identically to /api/reporting/pdf: sign-in + report:view + client scope
 * + balance lock — a graph is part of the report, so it must not leak past the
 * same gates.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ sid: string }> },
) {
  const { sid: raw } = await ctx.params;
  const sid = (raw ?? '').trim();
  if (!sid) return new NextResponse('Missing sid', { status: 400 });

  const user = await currentUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  if (!hasCapability(user.caps, 'report:view')) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  if (!(await canAccessSidReport(user, sid))) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const lock = await isSidReportLocked(sid);
  if (lock.locked) {
    return NextResponse.json(
      { error: 'BALANCE_LOCKED', reason: lock.reason, dueAmount: lock.dueAmount },
      { status: 423 },
    );
  }

  const meta = new URL(req.url).searchParams.get('meta');
  if (meta === '1' || meta === 'true') {
    const graphs = await listSidGraphs(sid);
    return NextResponse.json({
      count: graphs.length,
      tests: graphs.map((g) => g.testName).filter(Boolean),
    });
  }

  const file = await getSidGraphFile(sid);
  if (!file) return new NextResponse('No graph for this report', { status: 404 });
  const ext =
    file.mime === 'image/png' ? 'png' : file.mime === 'image/jpeg' ? 'jpg' : 'pdf';
  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      'Content-Type': file.mime,
      // Generic server-side name (no PII in the URL/header); the preview client
      // renames the blob to PatientName_SID_graph on save.
      'Content-Disposition': `attachment; filename="Graph_${sid}.${ext}"`,
      'Cache-Control': 'no-store',
    },
  });
}
