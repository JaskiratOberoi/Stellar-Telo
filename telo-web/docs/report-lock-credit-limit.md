# Report lock — per-client credit allowance & permanent unlock

Telo holds a client's reports while they owe Noble (the balance-based report
lock, `telo-web/lib/reportLock.ts`). B2B clients, however, can be exempted two
ways in the LIS, both of which Telo honors so it stays in step with the LIS:

1. **Credit allowance** — they may run a negative balance up to a per-client
   limit before reports lock.
2. **Permanent unlock** — a bit that force-unlocks the client's reports
   regardless of balance or credit limit.

This mirrors the legacy LIS gate (`Listec-Genomics.../MedCis.Business/Pcc/
WorksheetClass.cs`, the client active/blocked decision):
`if (PerminentUnlock || currentbalance > 0) active; else if (creditlimit < 0 &&
creditlimit < currentbalance) active; else blocked`. Both flags live on the same
`tbl_med_mcc_unit_master` row and Telo only **reads** them.

---

## Where the allowance lives

`dbo.tbl_med_mcc_unit_master.creditlimit` (nullable `int`), keyed by
`MCCUnitCode` (e.g. `HR0201`). It is set by an operator on the **legacy** MCC
Unit Master admin screen — Telo only **reads** it, never writes it. No Telo
sidecar table, no migration.

**Sign convention: the limit is a NEGATIVE floor** the wallet balance may sink
to before locking.

- `tbl_med_mcc_account_master.currentbalance`: positive = client in advance,
  negative = client owes Noble.
- `creditlimit = -5000` → the client may owe up to ₹5,000. Reports lock only
  once `currentbalance < -5000`.
- Example: `HR0201` (SHIV CLINICAL LAB) = `-5000`. At `currentbalance = -194`
  it is well within the allowance, so its reports stay **unlocked**.

---

## Permanent unlock

`dbo.tbl_med_mcc_unit_master.PerminentUnlock` (`bit`). When `true`, the client's
reports are unlocked no matter the balance or credit limit — it wins outright,
exactly as in the LIS (and independent of `IsActive`: e.g. `HR0032` / CITY
DIAGNOSTIC CENTRE is `IsActive = false`, `creditlimit = NULL`, but
`PerminentUnlock = true`, so its ~₹16.7L balance is **not** held). Set by the
operator on the same legacy admin screen; Telo only reads it.

## The rule (Telo, mirroring the LIS)

```
if (PerminentUnlock)                             => unlocked (wallet due = 0)
floor   = creditlimit < 0 ? creditlimit : 0      // NULL / 0 / positive => 0 (no allowance)
locked  = currentbalance < floor
dueAmount (behind the lock) = locked ? (floor - currentbalance) : 0   // amount OVER the limit
```

Implemented in:

- **`telo-web/lib/reportLock.ts`** — the actual per-report lock (view / print /
  PDF / bulk-download all gate on it). Wallet query selects `u.creditlimit` and
  `u.PerminentUnlock`; a set `PerminentUnlock` zeroes the wallet due outright,
  otherwise `walletDue = bal < floor ? floor - bal : 0`.
- **`telo-web/db/read/mccLedger.ts`** — `getMccAccountSummary()` returns a
  normalized `creditLimit` (`rawLimit < 0 ? rawLimit : 0`) and `permanentUnlock`,
  kept in lockstep.
- **`telo-web/app/(shop)/home/page.tsx`** — the home banner. Red "reports on
  hold" shows only when actually over the limit AND not permanently unlocked;
  a permanently-unlocked client with a balance sees "reports are unlocked", and
  within a real allowance it shows "within your ₹X credit limit — reports
  available".

The reporting-table lock pop-up (`components/reporting/reporting-view.tsx`)
needs no special handling — it reads `dueAmount` / `lockReason` straight from
`computeReportLocks`, so it automatically shows the over-limit amount and only
locks rows that are genuinely over.

---

## ⚠️ Positive-stored limits are deliberately ignored

The LIS rule only honors `creditlimit < 0`. A limit stored as a **positive**
number (or `NULL`/`0`) means **no allowance** — the client locks on any negative
balance. As of 2026-07, 19 clients had a positive-stored `creditlimit`; both the
LIS and Telo intentionally block them on any due (they're treated as no-allowance
data-entry, not a 65000-rupee credit line).

**Do not "fix" this** by normalizing with `-Math.abs(creditlimit)`. That was a
considered product decision (Telo must agree with the LIS gate, not diverge). If
a positive-limit client should actually get an allowance, the fix is to correct
the sign in the LIS admin screen, not to change this code.

---

## Verifying

Read-only diagnostics (from `telo-web/`, both hit the live production Noble
server — run deliberately):

- `node --env-file=.env db/scripts/diag-creditlimit.mjs` — HR0201's credit limit
  + the sign distribution across all units.
- `CODE=HR0032 node --env-file=.env db/scripts/diag-unlock.mjs` — a client's
  `creditlimit` / `PerminentUnlock` / `IsActive` flags + balance.
