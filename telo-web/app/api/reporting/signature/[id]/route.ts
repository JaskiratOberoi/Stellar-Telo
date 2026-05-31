import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getSignatureBytes } from '@/db/read/signatures';

export const dynamic = 'force-dynamic';

/**
 * Serves a doctor signature image from dbo.tbl_med_signature_master for the
 * customer report. Mirrors /api/mcc-invoice-logo: requires sign-in and the
 * Reporting capability, sends a strong ETag (sha1 of the bytes) and honours
 * If-None-Match so the report (and the headless-Chromium PDF render) don't
 * re-download the same image on every view.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return new NextResponse('Not found', { status: 404 });
  }

  const user = await currentUser();
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!hasCapability(user.caps, 'report:view')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const sig = await getSignatureBytes(id);
  if (!sig) {
    return new NextResponse('Not found', { status: 404 });
  }

  const etag = `"${createHash('sha1').update(sig.bytes).digest('hex')}"`;
  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'private, max-age=3600, must-revalidate',
      },
    });
  }

  return new NextResponse(new Uint8Array(sig.bytes), {
    status: 200,
    headers: {
      'Content-Type': sig.mime,
      'Cache-Control': 'private, max-age=3600, must-revalidate',
      ETag: etag,
    },
  });
}
