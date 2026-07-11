# Report lock — per-client credit allowance

Telo holds a client's reports while they owe Noble (the balance-based report
lock, `telo-web/lib/reportLock.ts`). B2B clients, however, are given a **credit
allowance** in the LIS: they may run a negative balance up to a limit before
reports lock. Telo honors that allowance so it stays in step with the LIS.

This mirrors the legacy LIS gate (`Listec-Genomics.../MedCis.Business/Pcc/
WorksheetClass.cs`, the client active/blocked decision), which reads the same
column.

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

## The rule (Telo, mirroring the LIS)

```
floor   = creditlimit < 0 ? creditlimit : 0     // NULL / 0 / positive => 0 (no allowance)
locked  = currentbalance < floor
dueAmount (behind the lock) = locked ? (floor - currentbalance) : 0   // amount OVER the limit
```

Implemented in:

- **`telo-web/lib/reportLock.ts`** — the actual per-report lock (view / print /
  PDF / bulk-download all gate on it). Wallet query selects `u.creditlimit`;
  `walletDue = bal < floor ? floor - bal : 0`.
- **`telo-web/db/read/mccLedger.ts`** — `getMccAccountSummary()` returns a
  normalized `creditLimit` (`rawLimit < 0 ? rawLimit : 0`), kept in lockstep.
- **`telo-web/app/(shop)/home/page.tsx`** — the home banner. The red "reports
  on hold" treatment shows only when actually over the limit; within the
  allowance it shows a calm "within your ₹X credit limit — reports available"
  note.

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

Read-only diagnostic (prints HR0201's value + the sign distribution across all
units): `node --env-file=.env db/scripts/diag-creditlimit.mjs` from `telo-web/`.
It queries the live production Noble server, so run it deliberately.
