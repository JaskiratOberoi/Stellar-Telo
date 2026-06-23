import { NextResponse } from 'next/server';
import { currentUser } from '@/auth/session';
import { getMccScope } from '@/auth/scope';
import { fetchScopedMccUnits, getMccCentreByCode } from '@/db/read/mccUnits';
import { createPaymentOrder } from '@/db/sp/paymentOrder';
import {
  getCcavenueConfig,
  newOrderId,
  buildCcavenueRequest,
  encryptCcavenue,
} from '@/lib/ccavenue';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Wallet/gateway amounts are INT rupees. Cap well above any real batch payment
// but below INT overflow — a sanity bound, not a per-client limit.
const MAX_AMOUNT = 5_000_000;

/** Minimal HTML-attribute escape for values interpolated into the form. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;',
  );
}

function back(status: string): NextResponse {
  return NextResponse.redirect(
    new URL(
      `/home?pay=${status}`,
      process.env.CCAVENUE_BASE_URL ||
        process.env.NEXTAUTH_URL ||
        'http://localhost:3000',
    ),
    { status: 303 },
  );
}

/**
 * Starts a CCAvenue online payment for a B2B client toward their Noble balance.
 * Same-origin POST from the Pay Now panel (cross-site POSTs don't carry the Lax
 * session cookie, so they fail the auth check). Validates session + MCC scope,
 * records a PENDING order (the callback's trust anchor), then returns a
 * self-submitting form that POSTs the AES-encrypted request to the gateway —
 * mirroring the legacy LIS Pcc/ccavRequestHandler.aspx.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return back('error');

  const cfg = getCcavenueConfig();
  if (!cfg) return back('unconfigured');

  const form = await req.formData();
  const mcc = Number(form.get('mcc'));
  const amount = Math.floor(Number(form.get('amount')));

  if (!Number.isInteger(mcc) || mcc <= 0) return back('error');
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return back('badamount');
  }

  // Scope check — unrestricted admins (>1000 centres) bypass the IN test.
  const scope = await getMccScope(user.uid);
  if (!(scope.length > 1000 || scope.includes(mcc))) return back('forbidden');

  // Billing details for the gateway (best-effort; CCAvenue tolerates blanks).
  const unit = (await fetchScopedMccUnits([mcc], [mcc]))[0];
  const centre = unit?.code ? await getMccCentreByCode(unit.code) : null;
  const billingName = (centre?.name || unit?.name || `Client ${mcc}`).slice(0, 60);

  const orderId = newOrderId();
  await createPaymentOrder({ orderId, mcc, userId: user.uid, amount });

  const requestString = buildCcavenueRequest({
    merchant_id: cfg.merchantId,
    order_id: orderId,
    currency: cfg.currency,
    amount: amount.toFixed(2),
    redirect_url: cfg.redirectUrl,
    cancel_url: cfg.cancelUrl,
    language: 'EN',
    billing_name: billingName,
    billing_address: (centre?.address || '').slice(0, 150),
    billing_city: (centre?.city || '').slice(0, 30),
    billing_state: '',
    billing_zip: '',
    billing_country: 'India',
    billing_tel: (centre?.phone || '').slice(0, 20),
    billing_email: (centre?.email || '').slice(0, 60),
    // Echoed back verbatim in the response — handy for reconciliation.
    merchant_param1: String(mcc),
    merchant_param2: String(user.uid),
  });

  const encRequest = encryptCcavenue(requestString, cfg.workingKey);

  audit({
    kind: 'mcc.online_payment.initiated',
    actor: user.uid,
    mcc,
    amount,
    orderId,
  });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Redirecting to secure payment…</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
    font-family:"Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;
    background:#0b1220;color:#e5e9f0}
  .box{text-align:center}
  .spin{width:42px;height:42px;border-radius:50%;margin:0 auto 18px;
    border:3px solid rgba(255,255,255,.15);border-top-color:#3b82f6;
    animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  p{font-size:15px;opacity:.85}
  small{opacity:.5}
  button{margin-top:14px;padding:8px 16px;border-radius:8px;border:0;
    background:#3b82f6;color:#fff;font-size:14px;cursor:pointer}
</style>
</head>
<body>
  <div class="box">
    <div class="spin"></div>
    <p>Redirecting to the secure CCAvenue payment page…</p>
    <small>Please don't press back or refresh.</small>
    <form id="ccav" method="post" action="${esc(cfg.requestUrl)}">
      <input type="hidden" name="encRequest" value="${esc(encRequest)}" />
      <input type="hidden" name="access_code" value="${esc(cfg.accessCode)}" />
      <noscript><button type="submit">Continue to payment</button></noscript>
    </form>
  </div>
  <script>document.getElementById('ccav').submit();</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
