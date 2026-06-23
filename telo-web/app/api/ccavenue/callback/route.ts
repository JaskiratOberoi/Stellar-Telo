import { NextResponse } from 'next/server';
import {
  getCcavenueConfig,
  decryptCcavenue,
  parseCcavenueResponse,
} from '@/lib/ccavenue';
import { recordMccOnlinePayment } from '@/db/sp/recordMccOnlinePayment';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function appBase(): string {
  return (
    process.env.CCAVENUE_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    'http://localhost:3000'
  );
}

/** 303 back to the client home with a status the page turns into a toast. */
function home(status: string, extra: Record<string, string> = {}): NextResponse {
  const url = new URL('/home', appBase());
  url.searchParams.set('pay', status);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, { status: 303 });
}

/**
 * CCAvenue redirect/cancel landing (server-to-browser POST from the gateway).
 * The session cookie is NOT reliably present here (cross-site Lax POST), so we
 * do NOT trust the session — authenticity comes from decrypting `encResp` with
 * our working key, and the mcc/amount/user come from the PENDING order row, not
 * from the posted fields. Idempotent: a replayed callback won't double-credit.
 * Mirrors the legacy LIS Pcc/ccavResponse.aspx.
 */
export async function POST(req: Request): Promise<Response> {
  const cfg = getCcavenueConfig();
  if (!cfg) return home('error');

  let parsed: Record<string, string>;
  try {
    const form = await req.formData();
    const encResp = String(form.get('encResp') ?? '');
    if (!encResp) return home('error');
    parsed = parseCcavenueResponse(decryptCcavenue(encResp, cfg.workingKey));
  } catch (e) {
    logger.error({ err: e }, 'ccavenue: failed to decrypt callback');
    return home('error');
  }

  const orderId = (parsed.order_id ?? '').trim();
  const status = (parsed.order_status ?? '').trim() || 'Unknown';
  if (!orderId) return home('error');

  const paidAmount = Number.parseFloat(parsed.amount ?? '');

  try {
    const res = await recordMccOnlinePayment({
      orderId,
      status,
      paidAmount: Number.isFinite(paidAmount) ? Math.round(paidAmount) : null,
      trackingId: parsed.tracking_id || null,
      bankRef: parsed.bank_ref_no || null,
      paymentMode: parsed.payment_mode || null,
    });

    audit({
      kind: 'mcc.online_payment.result',
      orderId,
      status,
      recorded: res.recorded,
      alreadyRecorded: res.alreadyRecorded,
    });

    if (res.recorded || res.alreadyRecorded) {
      return home('success', {
        amt: String(
          Number.isFinite(paidAmount) ? Math.round(paidAmount) : '',
        ),
        ref: parsed.tracking_id || orderId,
      });
    }
    // Handled, but not a successful payment.
    const s = status.toLowerCase();
    return home(s === 'aborted' ? 'cancelled' : 'failed');
  } catch (e) {
    logger.error({ err: e, orderId }, 'ccavenue: failed to record callback');
    return home('error');
  }
}

// Some CCAvenue configurations issue a GET to the cancel URL — treat it as a
// user-aborted return rather than an error.
export async function GET(): Promise<Response> {
  return home('cancelled');
}
