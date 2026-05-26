import { NextResponse } from 'next/server';
import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { getMccInvoiceLogoBytes } from '@/db/read/invoiceConfig';

export const dynamic = 'force-dynamic';

/**
 * Serves the per-MCC top-right invoice logo stored in dbo.telo_mcc_invoice_config.
 * Requires sign-in and MCC scope (or user:manage for admins configuring logos).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ mccId: string }> },
) {
  const { mccId: raw } = await ctx.params;
  const mccId = Number(raw);
  if (!Number.isInteger(mccId) || mccId <= 0) {
    return new NextResponse('Not found', { status: 404 });
  }

  const user = await currentUser();
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const scope = await getMccScope(user.uid);
  const canManage = hasCapability(user.caps, 'user:manage');
  if (!canManage && !scope.includes(mccId)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const logo = await getMccInvoiceLogoBytes(mccId);
  if (!logo) {
    return new NextResponse('Not found', { status: 404 });
  }

  return new NextResponse(new Uint8Array(logo.bytes), {
    status: 200,
    headers: {
      'Content-Type': logo.mime,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
