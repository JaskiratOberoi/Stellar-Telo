import { NextResponse } from 'next/server';
import { verifyReportToken } from '@/lib/report/reportLink';
import { renderFragmentToPdf } from '@/lib/report/renderPdf';
import { mergeOntoLetterhead } from '@/lib/report/letterheadPdf';

export const dynamic = 'force-dynamic';
// Headless Chromium needs the Node runtime (not Edge).
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * PUBLIC, token-gated report softcopy. The printed report's QR points here, so a
 * patient can scan it and download/verify their report PDF without logging in.
 * Access is gated entirely by the per-SID HMAC token (`t`) — an invalid/missing
 * token is indistinguishable from a missing report (404), preventing SID
 * enumeration. The PDF is produced by the same render+letterhead pipeline as the
 * authenticated download, with the print fragment authorised by the token.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ sid: string }> },
) {
  const { sid } = await params;
  const decoded = decodeURIComponent(sid).trim();
  const url = new URL(req.url);
  const token = url.searchParams.get('t');
  const date = url.searchParams.get('d');

  if (!decoded || !verifyReportToken(decoded, token)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const dateParam = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `&date=${date}` : '';
  const fragmentPath = `/print/reporting/${encodeURIComponent(decoded)}?pdf=1&split=1&token=${encodeURIComponent(
    token!,
  )}${dateParam}`;

  try {
    const content = await renderFragmentToPdf(fragmentPath, null);
    const merged = await mergeOntoLetterhead(content);
    return new NextResponse(new Uint8Array(merged), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${decoded}.pdf"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch {
    return new NextResponse('Could not generate report.', { status: 500 });
  }
}
