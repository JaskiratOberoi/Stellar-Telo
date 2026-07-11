import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Read-only access to the legacy LIS **franchise wallet** ledger
 * (`tbl_med_mcc_account_master` / `tbl_med_mcc_account_detail`). This is the
 * B2B client-account ledger the LIS owns and settles; Telo NEVER writes here.
 *
 * The numbers mirror the legacy `MccAccountClass` (MedCis.Business/Pcc) exactly
 * so this view agrees with the LIS `Admin_General/Mcc_Account.aspx` screen:
 *
 *  - Current Balance      = master.currentbalance (live running value)
 *  - Total Deposited       = SUM(detail.amount) WHERE credittype=1 AND debit_flag
 *                            is null/0  — the RECOMPUTED value the LIS UI shows
 *                            (GetMccTotalAmountDeposited), NOT the stale
 *                            master.totaldeposited column.
 *  - Total Test Charges    = SUM(tests.test_rate) WHERE amount_checked=1
 *  - period Payments       = same as Total Deposited but bounded by depositedate
 *  - period Test Charges   = same as Total Test Charges but bounded by updateddate
 *
 * Detail rows carry the online-payment metadata the LIS CCAvenue portal
 * auto-populates: chequeorddnummber = `<timestamp>-<mccId>` order id, Reason =
 * UPI RRN, addedby = 'Online'. We surface `isOnline` off that marker.
 *
 * Scope is the CALLER's responsibility — pages validate the mccId is in the
 * user's `getMccScope` before calling (defence-in-depth, mirroring the
 * /balances/[mcc] pattern).
 */

/** credittype → label (mirrors MccAccountClass.GetDepositType). */
const CREDIT_TYPE_LABEL: Record<number, string> = {
  1: 'Payment',
  2: 'Credit',
  3: 'Debit',
};

/** deposittype → label (mirrors MccAccountClass.GetPaymentMode). */
const PAYMENT_MODE_LABEL: Record<number, string> = {
  1: 'DD',
  2: 'Cheque',
  3: 'Cash',
  4: 'NEFT/iNet/Transfer',
  5: 'Online',
  6: 'Other',
  7: 'Reject',
};

export function creditTypeLabel(t: number | null): string {
  return (t != null && CREDIT_TYPE_LABEL[t]) || 'Debit';
}

/** Payment-type filter for the detail grid (mirrors the LIS "Choose Type"). */
export type AccountTypeFilter = 'payment' | 'credit' | 'debit';
const TYPE_TO_CREDITTYPE: Record<AccountTypeFilter, number> = {
  payment: 1,
  credit: 2,
  debit: 3,
};
export function paymentModeLabel(m: number | null): string {
  return (m != null && PAYMENT_MODE_LABEL[m]) || '';
}

export interface MccAccountSummary {
  /** Live running wallet balance (negative = client owes the lab). */
  currentBalance: number;
  /**
   * Per-client credit allowance from the LIS (tbl_med_mcc_unit_master.creditlimit).
   * Stored as a NEGATIVE floor the balance may sink to before reports lock
   * (e.g. -2500 = may owe up to ₹2500). 0 here = no allowance (NULL/0/positive
   * in the LIS all normalise to 0). Report-lock uses the same value via reportLock.ts.
   */
  creditLimit: number;
  /** All-time deposits recomputed from detail (NOT the stale master column). */
  totalDeposited: number;
  /** All-time test charges (amount_checked rows). */
  totalTestCharges: number;
  /** Deposits within the selected date window. */
  periodPayments: number;
  /** Test charges within the selected date window. */
  periodTestCharges: number;
}

export interface MccAccountDetailRow {
  id: number;
  /** Deposit date (ISO). */
  date: string | null;
  /** Payment / Credit / Debit. */
  type: string;
  /** chequeorddnummber — for online rows this is the auto-generated txn id. */
  chequeNo: string | null;
  /** Payment mode label (Online, Cash, Cheque, …). */
  mode: string;
  amount: number;
  /** Reason — for online rows this carries the UPI RRN / bank reference. */
  reason: string | null;
  /** True when the LIS CCAvenue portal auto-posted this (addedby='Online'). */
  isOnline: boolean;
  /** True when the row is flagged inactive (excluded from payment totals). */
  inactive: boolean;
}

/**
 * Header figures for the franchise wallet, mirroring the four boxes + the two
 * period counters on the LIS Mcc_Account screen. One round-trip (scalar
 * sub-selects). Dates bind as 'YYYY-MM-DD' and CAST in SQL — same IST
 * calendar-day handling as db/read/ledger.ts.
 */
export async function getMccAccountSummary(
  mccId: number,
  range: { from: string; to: string },
): Promise<MccAccountSummary> {
  if (!Number.isInteger(mccId)) {
    return {
      currentBalance: 0,
      creditLimit: 0,
      totalDeposited: 0,
      totalTestCharges: 0,
      periodPayments: 0,
      periodTestCharges: 0,
    };
  }
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('mcc', sql.Int, mccId)
      .input('from', sql.VarChar(10), range.from)
      .input('to', sql.VarChar(10), range.to)
      .query<{
        currentBalance: number | null;
        creditLimit: number | null;
        totalDeposited: number | null;
        totalTestCharges: number | null;
        periodPayments: number | null;
        periodTestCharges: number | null;
      }>(`
        SELECT
          (SELECT TOP 1 m.currentbalance
             FROM dbo.tbl_med_mcc_account_master m
            WHERE m.mcccode = @mcc) AS currentBalance,
          (SELECT TOP 1 u.creditlimit
             FROM dbo.tbl_med_mcc_unit_master u
            WHERE u.id = @mcc) AS creditLimit,
          (SELECT SUM(d.amount)
             FROM dbo.tbl_med_mcc_account_detail d
            WHERE d.mcccode = @mcc AND d.credittype = 1
              AND (d.debit_flag IS NULL OR d.debit_flag = 0)) AS totalDeposited,
          (SELECT SUM(t.test_rate)
             FROM dbo.tbl_med_mcc_patient_tests t
             JOIN dbo.tbl_med_mcc_patient_master p ON p.id = t.patient_id
            WHERE p.mcc_code = @mcc AND t.amount_checked = 1) AS totalTestCharges,
          (SELECT SUM(d.amount)
             FROM dbo.tbl_med_mcc_account_detail d
            WHERE d.mcccode = @mcc AND d.credittype = 1
              AND (d.debit_flag IS NULL OR d.debit_flag = 0)
              AND d.depositedate >= CAST(@from AS DATE)
              AND d.depositedate <  DATEADD(day, 1, CAST(@to AS DATE))) AS periodPayments,
          (SELECT SUM(t.test_rate)
             FROM dbo.tbl_med_mcc_patient_tests t
             JOIN dbo.tbl_med_mcc_patient_master p ON p.id = t.patient_id
            WHERE p.mcc_code = @mcc AND t.amount_checked = 1
              AND t.updateddate >= CAST(@from AS DATE)
              AND t.updateddate <  DATEADD(day, 1, CAST(@to AS DATE))) AS periodTestCharges
      `);
    const x = r.recordset[0] ?? {};
    // Normalise to the LIS convention: only a negative limit is a real
    // allowance; NULL/0/positive => 0 (no allowance). Keep in lockstep with
    // the floor logic in lib/reportLock.ts.
    const rawLimit = Number(x.creditLimit ?? 0);
    return {
      currentBalance: Number(x.currentBalance ?? 0),
      creditLimit: rawLimit < 0 ? rawLimit : 0,
      totalDeposited: Number(x.totalDeposited ?? 0),
      totalTestCharges: Number(x.totalTestCharges ?? 0),
      periodPayments: Number(x.periodPayments ?? 0),
      periodTestCharges: Number(x.periodTestCharges ?? 0),
    };
  });
}

/**
 * Detail rows for the franchise wallet within the date window, newest first.
 * Mirrors MccAccountClass.GetAccounts (date-bounded on depositedate). Capped at
 * 2000 rows — a wide range on a busy centre can be large; the date filter keeps
 * the common case small and the cap prevents a runaway payload.
 */
export async function listMccAccountDetail(
  mccId: number,
  range: { from: string; to: string },
  type: AccountTypeFilter | null = null,
): Promise<MccAccountDetailRow[]> {
  if (!Number.isInteger(mccId)) return [];
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool
      .request()
      .input('mcc', sql.Int, mccId)
      .input('from', sql.VarChar(10), range.from)
      .input('to', sql.VarChar(10), range.to);
    // Optional payment-type filter (LIS "Choose Type").
    let typeClause = '';
    if (type && TYPE_TO_CREDITTYPE[type] != null) {
      req.input('ctype', sql.Int, TYPE_TO_CREDITTYPE[type]);
      typeClause = 'AND d.credittype = @ctype';
    }
    const r = await req
      .query<{
        id: number;
        depositedate: Date | null;
        credittype: number | null;
        deposittype: number | null;
        chequeorddnummber: string | null;
        amount: number | null;
        reason: string | null;
        addedby: string | null;
        debit_flag: boolean | null;
      }>(`
        SELECT TOP (2000)
          d.id,
          d.depositedate,
          d.credittype,
          d.deposittype,
          d.chequeorddnummber,
          d.amount,
          d.Reason AS reason,
          d.addedby,
          d.debit_flag
        FROM dbo.tbl_med_mcc_account_detail d
        WHERE d.mcccode = @mcc
          AND d.depositedate >= CAST(@from AS DATE)
          AND d.depositedate <  DATEADD(day, 1, CAST(@to AS DATE))
          ${typeClause}
        ORDER BY d.depositedate DESC, d.id DESC
      `);
    return r.recordset.map((x) => ({
      id: x.id,
      date: x.depositedate ? x.depositedate.toISOString() : null,
      type: creditTypeLabel(x.credittype),
      chequeNo: x.chequeorddnummber ? String(x.chequeorddnummber).trim() || null : null,
      mode: paymentModeLabel(x.deposittype),
      amount: Number(x.amount ?? 0),
      reason: x.reason ? String(x.reason).trim() || null : null,
      isOnline: (x.addedby ?? '').trim().toLowerCase() === 'online',
      inactive: x.debit_flag === true,
    }));
  });
}
