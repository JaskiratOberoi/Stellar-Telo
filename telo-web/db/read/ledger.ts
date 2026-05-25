import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/** One per-MCC row of the LIS-style accounts rollup, scoped to Telo bills. */
export interface AccountsRow {
  mccId: number;
  mccCode: string;
  mccName: string | null;
  bills: number;
  charges: number;
  discount: number;
  net: number;
  received: number;
  refund: number;
  payingBalance: number;
  creditBalance: number;
  balance: number;
}

export interface PendingBillRow {
  billId: number;
  billNumber: number | null;
  billDate: string | null;
  patientName: string | null;
  patientId: number | null;
  amount: number;
  amountPaid: number;
  balance: number;
}

function scopeParams(req: sql.Request, scope: number[]): string {
  return scope
    .map((c, i) => {
      req.input(`s${i}`, sql.Int, c);
      return `@s${i}`;
    })
    .join(',');
}

/**
 * Per-MCC accounts rollup for Telo-originated bills, date-bounded by
 * `bill_date`. Mirrors the LIS `LabOperation.aspx` → Total modal columns; every
 * row reconciles: `Net = Charges − Discount`, `Balance = Net − Received − Refund
 * = Paying + Credit`. `Refund` is a placeholder (Telo doesn't track refunds
 * yet — included for parity with the LIS view).
 *
 * The Paying / Credit split: any `payment_type` containing 'CREDIT' (the LIS
 * convention, e.g. 'CGHS CREDIT') is treated as credit; everything else
 * (Telo's Cash/UPI/Card/Cheque or NULL) is paying.
 *
 * The `from` / `to` bounds are inclusive of full local days — we filter
 * `bill_date >= @from AND bill_date < @to + 1 day` so the upper bound captures
 * a same-day range correctly even though `bill_date` includes a time-of-day.
 */
export async function summarizeTeloAccounts(
  scope: number[],
  fromIso: string,
  toIso: string,
  filters: {
    /** Restrict to one MCC (must be in scope). Null = all in-scope MCCs. */
    mccId?: number | null;
    /** Match on payment_type — 'cash' / 'credit' / null = any. */
    paymentMode?: 'cash' | 'credit' | null;
  } = {},
): Promise<AccountsRow[]> {
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  const unrestricted = ids.length > 1000;
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('from', sql.DateTime, new Date(fromIso));
    req.input('to', sql.DateTime, new Date(toIso));
    let scopeClause = unrestricted
      ? ''
      : `AND b.mcc_code IN (${scopeParams(req, ids)})`;
    // Single-MCC filter — overrides the scope list with one validated id.
    if (
      filters.mccId != null &&
      Number.isInteger(filters.mccId) &&
      (unrestricted || ids.includes(filters.mccId))
    ) {
      req.input('mccOne', sql.Int, filters.mccId);
      scopeClause = 'AND b.mcc_code = @mccOne';
    }
    let paymentClause = '';
    if (filters.paymentMode === 'credit') {
      paymentClause = `AND b.payment_type LIKE '%CREDIT%'`;
    } else if (filters.paymentMode === 'cash') {
      paymentClause = `AND (b.payment_type IS NULL OR b.payment_type NOT LIKE '%CREDIT%')`;
    }
    const r = await req.query<{
      mccId: number;
      mccCode: string | null;
      mccName: string | null;
      bills: number;
      charges: number;
      discount: number;
      net: number;
      received: number;
      refund: number;
      payingBalance: number;
      creditBalance: number;
      balance: number;
    }>(`
      SELECT
        m.id AS mccId,
        m.MCCUnitCode AS mccCode,
        m.MCCUnitName AS mccName,
        COUNT(*) AS bills,
        SUM(b.amount) AS charges,
        SUM(ISNULL(b.discount_amount, 0)) AS discount,
        SUM(b.amount - ISNULL(b.discount_amount, 0)) AS net,
        SUM(ISNULL(b.amount_paid, 0)) AS received,
        SUM(ISNULL(rf.refund, 0)) AS refund,
        SUM(CASE
              WHEN b.payment_type IS NULL
                OR b.payment_type NOT LIKE '%CREDIT%'
              THEN ISNULL(b.Balance, 0) ELSE 0
            END) AS payingBalance,
        SUM(CASE
              WHEN b.payment_type LIKE '%CREDIT%'
              THEN ISNULL(b.Balance, 0) ELSE 0
            END) AS creditBalance,
        SUM(ISNULL(b.Balance, 0)) AS balance
      FROM dbo.tbl_billing_patient_detail b
      JOIN dbo.tbl_med_mcc_unit_master m ON m.id = b.mcc_code
      OUTER APPLY (
        -- Per-bill refund total: receipts marked with receive_status='2' by
        -- usp_telo_record_refund. Informational column (Telo's amount_paid
        -- already nets refunds, so Net - Received = Balance still holds).
        SELECT SUM(rcpt.amount) AS refund
        FROM dbo.tbl_billing_patient_amount_receipt rcpt
        WHERE rcpt.bill_id = b.id AND rcpt.receive_status = '2'
      ) rf
      WHERE b.addedby LIKE 'telo:%'
        AND b.bill_date >= @from
        AND b.bill_date <  DATEADD(day, 1, @to)
        ${scopeClause}
        ${paymentClause}
      GROUP BY m.id, m.MCCUnitCode, m.MCCUnitName
      ORDER BY SUM(ISNULL(b.Balance, 0)) DESC, m.MCCUnitCode
    `);
    return r.recordset.map((x) => ({
      mccId: x.mccId,
      mccCode: (x.mccCode ?? '').trim(),
      mccName: x.mccName ? x.mccName.trim() : null,
      bills: Number(x.bills ?? 0),
      charges: Number(x.charges ?? 0),
      discount: Number(x.discount ?? 0),
      net: Number(x.net ?? 0),
      received: Number(x.received ?? 0),
      refund: Number(x.refund ?? 0),
      payingBalance: Number(x.payingBalance ?? 0),
      creditBalance: Number(x.creditBalance ?? 0),
      balance: Number(x.balance ?? 0),
    }));
  });
}

/**
 * Bills (Telo-originated) for one MCC within the same date window — drives the
 * /balances/[mcc] drill-down so its numbers agree with the rollup row.
 * `medid` carries the patient_id for Telo bills (so the row links to the
 * receipt).
 */
export async function listTeloBillsForMcc(
  mccId: number,
  scope: number[],
  fromIso: string,
  toIso: string,
): Promise<PendingBillRow[]> {
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  const unrestricted = ids.length > 1000;
  if (!unrestricted && !ids.includes(mccId)) return [];
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('mcc', sql.Int, mccId)
      .input('from', sql.DateTime, new Date(fromIso))
      .input('to', sql.DateTime, new Date(toIso))
      .query<{
        billId: number;
        billNumber: number | null;
        billDate: Date | null;
        patientName: string | null;
        patientId: number | null;
        amount: number;
        amountPaid: number;
        balance: number;
      }>(`
        SELECT
          b.id AS billId, b.bill_number AS billNumber,
          b.bill_date AS billDate, b.patientname AS patientName,
          TRY_CONVERT(INT, b.medid) AS patientId,
          b.amount AS amount, b.amount_paid AS amountPaid,
          b.Balance AS balance
        FROM dbo.tbl_billing_patient_detail b
        WHERE b.addedby LIKE 'telo:%'
          AND b.mcc_code = @mcc
          AND b.bill_date >= @from
          AND b.bill_date <  DATEADD(day, 1, @to)
        ORDER BY b.bill_date DESC, b.id DESC
      `);
    return r.recordset.map((x) => ({
      billId: x.billId,
      billNumber: x.billNumber,
      billDate: x.billDate ? x.billDate.toISOString() : null,
      patientName: x.patientName ? x.patientName.trim() : null,
      patientId: x.patientId,
      amount: Number(x.amount ?? 0),
      amountPaid: Number(x.amountPaid ?? 0),
      balance: Number(x.balance ?? 0),
    }));
  });
}
