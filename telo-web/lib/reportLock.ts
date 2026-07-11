import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { getWorksheetReports } from '@/lib/listec';

/**
 * Balance-based report lock — TELO ONLY.
 *
 * A report cannot be viewed or printed in Telo while there is an outstanding
 * balance. Two billing models, two rules (product decision):
 *   - B2C (the patient has their OWN per-patient bill, e.g. MEDICARE/MDCARE):
 *     locked when that patient's bill balance > 0. The client wallet is NOT
 *     used — B2C payments never post to the LIS client account, so its balance
 *     is a permanent phantom negative.
 *   - B2B (the patient has NO per-patient bill — Noble bills the client wallet
 *     in bulk, e.g. SHIV/HR0201): locked when the client's wallet balance drops
 *     to/below its credit allowance (i.e. the client owes more than allowed).
 *
 * Credit allowance (B2B): the legacy LIS lets a client owe up to a per-client
 * limit before blocking — `tbl_med_mcc_unit_master.creditlimit`, stored as a
 * NEGATIVE floor the balance may sink to (e.g. -2500 = may owe up to ₹2500).
 * We mirror the LIS exactly: the allowance applies only when creditlimit < 0;
 * NULL/0/positive = no allowance (locked on any negative balance). The lock's
 * dueAmount is the amount OVER the allowance, not the full balance.
 *
 * Permanent unlock (B2B): the LIS `tbl_med_mcc_unit_master.PerminentUnlock` bit
 * force-unlocks a client's reports regardless of balance or credit limit (legacy
 * rule: PerminentUnlock => active). We honor it the same way — a set bit zeroes
 * the client wallet due so its reports never lock on the wallet balance.
 *
 * Unified: locked = patientBillDue > 0 OR (noOwnBill AND clientWalletDue > 0).
 *
 * All reads are read-only against the shared LIS/Telo bill + client-account
 * tables — the LIS keeps working unchanged; this gate lives entirely in Telo.
 */
export interface ReportLock {
  locked: boolean;
  reason: 'patient' | 'client' | null;
  /** Outstanding amount (₹) behind the lock — for the operator-facing message. */
  dueAmount: number;
}

const UNLOCKED: ReportLock = { locked: false, reason: null, dueAmount: 0 };

interface LockItem {
  sid: string;
  pid: number | null;
  clientCode: string | null;
}

const normCode = (c: string | null | undefined) => (c ?? '').trim().toUpperCase();

/**
 * Compute the balance lock for a batch of report rows in two grouped queries
 * (per-patient bill dues by pid; client wallet balances by client code).
 * Returns a map keyed by SID.
 */
export async function computeReportLocks(
  items: LockItem[],
): Promise<Map<string, ReportLock>> {
  const out = new Map<string, ReportLock>();
  if (items.length === 0) return out;

  const pids = [...new Set(items.map((i) => i.pid).filter((n): n is number => Number.isInteger(n) && (n as number) > 0))];
  const codes = [...new Set(items.map((i) => normCode(i.clientCode)).filter(Boolean))];

  const { patientDue, hasOwnBill, walletDue } = await withRetry(async () => {
    const pool = await getPool();

    // Per-patient bill dues (B2C). medid holds the patient master id on
    // per-patient bills (LIS + Telo alike). Zero rows => patient has no own bill.
    const patientDue = new Map<number, number>();
    const hasOwnBill = new Set<number>();
    for (let i = 0; i < pids.length; i += 1500) {
      const slice = pids.slice(i, i + 1500);
      const req = pool.request();
      const ph = slice.map((v, j) => { req.input('p' + j, sql.Int, v); return '@p' + j; });
      const r = await req.query<{ pid: number; due: number; billCount: number }>(`
        SELECT TRY_CONVERT(INT, medid) AS pid,
               SUM(CASE WHEN ISNULL(Balance, 0) > 0 THEN Balance ELSE 0 END) AS due,
               COUNT(*) AS billCount
        FROM dbo.tbl_billing_patient_detail
        WHERE TRY_CONVERT(INT, medid) IN (${ph.join(',')})
        GROUP BY TRY_CONVERT(INT, medid)`);
      for (const row of r.recordset) {
        if (row.pid == null) continue;
        patientDue.set(row.pid, Number(row.due ?? 0));
        if (Number(row.billCount ?? 0) > 0) hasOwnBill.add(row.pid);
      }
    }

    // Client wallet balance (B2B). currentbalance < 0 = client owes Noble.
    // creditlimit (< 0) is the allowed floor: locked only once bal drops below it.
    // PerminentUnlock force-unlocks the client regardless of balance.
    const walletDue = new Map<string, number>();
    for (let i = 0; i < codes.length; i += 1500) {
      const slice = codes.slice(i, i + 1500);
      const req = pool.request();
      const ph = slice.map((v, j) => { req.input('c' + j, sql.VarChar(50), v); return '@c' + j; });
      const r = await req.query<{ code: string; bal: number | null; creditlimit: number | null; punlock: boolean | null }>(`
        SELECT u.MCCUnitCode AS code, a.currentbalance AS bal, u.creditlimit AS creditlimit,
               u.PerminentUnlock AS punlock
        FROM dbo.tbl_med_mcc_unit_master u
        LEFT JOIN dbo.tbl_med_mcc_account_master a ON a.mcccode = u.id
        WHERE UPPER(u.MCCUnitCode) IN (${ph.join(',')})`);
      for (const row of r.recordset) {
        // Permanent unlock wins outright (LIS: PerminentUnlock => active).
        if (row.punlock === true) {
          walletDue.set(normCode(row.code), 0);
          continue;
        }
        const bal = Number(row.bal ?? 0);
        // Allowed floor the balance may sink to (LIS convention: only negative
        // limits count; NULL/0/positive => 0 = no allowance).
        const floor = Number(row.creditlimit ?? 0) < 0 ? Number(row.creditlimit) : 0;
        // Locked once balance drops below the floor; due = amount over the floor.
        walletDue.set(normCode(row.code), bal < floor ? floor - bal : 0);
      }
    }
    return { patientDue, hasOwnBill, walletDue };
  });

  for (const it of items) {
    const pid = it.pid ?? -1;
    const pDue = patientDue.get(pid) ?? 0;
    const ownBill = hasOwnBill.has(pid);
    const cDue = walletDue.get(normCode(it.clientCode)) ?? 0;
    if (pDue > 0) {
      out.set(it.sid, { locked: true, reason: 'patient', dueAmount: pDue });
    } else if (!ownBill && cDue > 0) {
      out.set(it.sid, { locked: true, reason: 'client', dueAmount: cDue });
    } else {
      out.set(it.sid, UNLOCKED);
    }
  }
  return out;
}

/**
 * Single-SID lock — for the preview page and PDF routes. Resolves the SID's
 * patient + client via the worksheet feed (one call), then runs the same rule.
 * Unknown SID => unlocked (nothing to gate; downstream 404s on its own).
 */
export async function isSidReportLocked(sid: string): Promise<ReportLock> {
  const target = (sid ?? '').trim();
  if (!target) return UNLOCKED;
  const rows = await getWorksheetReports({
    sid: target,
    fromDate: '2015-01-01',
    toDate: '2100-01-01',
    pageSize: 20,
  });
  const row = rows.find((r) => (r.sid ?? '').trim() === target);
  if (!row) return UNLOCKED;
  const locks = await computeReportLocks([
    { sid: target, pid: row.pid, clientCode: row.client_code },
  ]);
  return locks.get(target) ?? UNLOCKED;
}
