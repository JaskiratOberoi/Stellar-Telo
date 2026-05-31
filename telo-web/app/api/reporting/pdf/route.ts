import { NextResponse } from 'next/server';
import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
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
 * Gated to `report:view` (super admin only today).
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
  try {
    ({ sid, panel, date } = await req.json());
  } catch {
    return new NextResponse('Bad request', { status: 400 });
  }
  if (typeof sid !== 'string' || !sid.trim()) {
    return new NextResponse('Missing sid', { status: 400 });
  }
  const panelId = typeof panel === 'string' && panel.trim() ? panel.trim() : '';
  const dateHint = typeof date === 'string' && date.trim() ? date.trim() : '';

  const fragmentPath = `/print/reporting/${encodeURIComponent(sid.trim())}?pdf=1${
    panelId ? `&panel=${encodeURIComponent(panelId)}` : ''
  }${dateHint ? `&date=${encodeURIComponent(dateHint)}` : ''}`;

  try {
    const content = await renderFragmentToPdf(
      fragmentPath,
      req.headers.get('cookie'),
    );
    const merged = await mergeOntoLetterhead(content);

    return new NextResponse(new Uint8Array(merged), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="TSH-${sid.trim()}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(`PDF generation failed: ${msg}`, { status: 500 });
  }
}
