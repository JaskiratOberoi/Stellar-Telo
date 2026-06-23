# Online client payments (CCAvenue)

B2B clients can now pay their outstanding balance to Noble online. They are
greeted on a new animated home (`/home`) with their balance and a **Pay Now**
panel; on success the payment posts straight into the shared LIS franchise
wallet (`tbl_med_mcc_account_*`) as an **Online** deposit, so the balance
reconciles in both Telo and the LIS `Mcc_Account` screen.

This mirrors the legacy LIS flow (`Listec/.../Pcc/ccavRequestHandler.aspx` +
`ccavResponse.aspx`) but with a hardened, idempotent server side.

---

## How it works

```
Client opens Telo            → lands on /home (animated, Noble-branded)
Enters amount (prefilled due)→ POST /api/ccavenue/initiate (same-origin)
   ├─ validates session + MCC scope
   ├─ INSERTs a PENDING dbo.telo_payment_order  (the trust anchor)
   └─ returns a self-submitting form → POSTs encRequest to CCAvenue
CCAvenue collects payment    → POSTs encResp back to
                               https://telo.genomicslab.in/api/ccavenue/callback
   ├─ decrypts with the Working Key
   ├─ usp_telo_record_mcc_online_payment (idempotent):
   │     looks up the order → posts ONE Online credit (deposittype=5,
   │     addedby='telo:<userId>') → flips order to SUCCESS
   └─ 303 redirect → /home?pay=success  (shows a confirmation toast)
```

Key safety properties:

- **The callback never trusts the browser.** The mcc / amount / user come from
  the `telo_payment_order` row we wrote at initiate, not from the posted fields.
- **Idempotent.** A replayed or duplicate callback (CCAvenue can POST twice; the
  user may refresh) is a no-op — the wallet is credited exactly once.
- **Authenticity** comes from decrypting `encResp` with the Working Key (a shared
  secret only Noble and CCAvenue hold).
- **Secrets** (`merchant_id` / `access_code` / `working_key`) live only in `.env`
  — never committed. If any is blank, Pay Now is disabled automatically.

---

## 1 · Register `telo.genomicslab.in` with CCAvenue

CCAvenue ties each **Working Key + Access Code** to a specific registered URL and
validates the redirect/cancel URLs against it. Telo runs at
`https://telo.genomicslab.in`, which is **not** one of the three URLs currently on
merchant **217208** (`www.genomicslab.in`, `122.161.198.159:88`, `noble.listec.in`),
so we register it as a new additional URL and get a fresh key pair for it.

1. **Log in** to the CCAvenue / Infibeam Avenues merchant dashboard
   (`https://dashboard.ccavenue.com`, Merchant ID **217208**, "QUGEN PATHLABS
   PRIVATE LIMITED").
2. **The Web Store URL list is display-only.** Under
   *Settings → Gateway Settings → Web Store URL* you'll see the registered URLs
   (`www.genomicslab.in` ★, `122.161.198.159:88`, `noble.listec.in`) but **no
   "Add URL" control** — CCAvenue guards this as a security setting ("Requests
   from any other urls for this merchant account will not be processed"). Adding
   a URL is done by **CCAvenue's team**, not self-service.
3. **Raise a request** via the dashboard's **Support** menu (top nav → raise a
   ticket/query) or email `service@ccavenue.com` / your relationship manager
   from the registered account:

   > Merchant ID **217208** (QUGEN PATHLABS PRIVATE LIMITED). Please add
   > **`https://telo.genomicslab.in`** as an additional Web Store URL on our
   > account and issue an **Access Code + Working Key** for it. The
   > redirect/cancel URL will be `https://telo.genomicslab.in/api/ccavenue/callback`.
   > This is a new billing portal on our existing infrastructure.

4. Once CCAvenue confirms, open **Settings → API Keys**. The new URL appears with
   its own **Access Code** and **Working Key** — note both. The **Merchant ID
   stays 217208**.
5. **Whitelist the callback.** Ensure CCAvenue accepts the redirect/cancel URL
   `https://telo.genomicslab.in/api/ccavenue/callback`. On most accounts the URL
   only needs to be under the registered domain; if your account enforces an
   explicit "Response Handler URL", set it to that path.
6. **Enable payment options** (Cards / Net Banking / UPI / Wallets) for the new
   URL if they are toggled per-URL.
7. **(Recommended) Test first.** Ask CCAvenue for **test-environment**
   credentials, set `CCAVENUE_REQUEST_URL` to
   `https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction`,
   run a ₹1 transaction end-to-end, then switch back to production keys + URL.

> The DNS/host for `telo.genomicslab.in` must already resolve to the Caddy box
> (it does — Caddy proxies it to `127.0.0.1:3110`). CCAvenue must be able to POST
> to it over HTTPS, which Caddy already serves with auto-TLS.

## 2 · Set the environment variables

Add to `telo-web/.env` (gitignored — never commit real keys):

```dotenv
CCAVENUE_MERCHANT_ID=217208
CCAVENUE_ACCESS_CODE=<access code for telo.genomicslab.in>
CCAVENUE_WORKING_KEY=<working key for telo.genomicslab.in>
CCAVENUE_BASE_URL=https://telo.genomicslab.in
CCAVENUE_REQUEST_URL=https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction
CCAVENUE_CURRENCY=INR
# CCAVENUE_REDIRECT_URL / CCAVENUE_CANCEL_URL are derived as
# <CCAVENUE_BASE_URL>/api/ccavenue/callback — only set them to override.
```

Then redeploy telo-web so it picks up the new env (`docker compose up -d telo-web`
from the repo root, or restart the dev server).

## 3 · Deploy the database objects (production migration)

Two new SQL artefacts must be applied to **Noble** (⚠️ production — needs
explicit authorization; the sidecar table is harmless, the SP touches the shared
wallet on the success path):

```bash
cd telo-web
npm run deploy:sp -- ./db/sql/29_table_telo_payment_order.sql
npm run deploy:sp -- ./db/sql/86_usp_telo_record_mcc_online_payment.sql
```

Both are idempotent to re-run (guarded `CREATE` / `CREATE OR ALTER`).

## 4 · Smoke test

1. Log in as a B2B **client** account → you should land on `/home` with the Noble
   logo, your balance, and the Pay Now panel.
2. Enter ₹1 (or tap *Pay full due*) → **Pay securely** → CCAvenue page loads.
3. Complete the test payment → you return to `/home?pay=success` with a toast,
   and the amount appears under **Recent payments** and on
   `/client-accounts/<mcc>` (and in the LIS `Mcc_Account` screen) as an **Online**
   credit with the order id in the Cheque/Txn column.
4. Try **Cancel** on the CCAvenue page → returns with a "Payment cancelled" toast
   and **no** wallet change.

---

## Files

| Concern | File |
|---|---|
| Crypto + config | `telo-web/lib/ccavenue.ts` |
| Order table (trust anchor) | `telo-web/db/sql/29_table_telo_payment_order.sql` |
| Idempotent post SP | `telo-web/db/sql/86_usp_telo_record_mcc_online_payment.sql` |
| DB wrappers | `telo-web/db/sp/paymentOrder.ts`, `telo-web/db/sp/recordMccOnlinePayment.ts` |
| Initiate (encrypt + redirect) | `telo-web/app/api/ccavenue/initiate/route.ts` |
| Callback (decrypt + post) | `telo-web/app/api/ccavenue/callback/route.ts` |
| Client home | `telo-web/app/(shop)/home/page.tsx` |
| Pay panel / status toast | `telo-web/components/client-home/*` |
| Routing (client → /home) | `telo-web/app/(shop)/layout.tsx`, `telo-web/app/(shop)/dashboard/page.tsx` |
