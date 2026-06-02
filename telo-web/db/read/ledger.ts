import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { getReceiptsInPeriod } from '@/db/read/receipts';

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
  doctorName: string | null;
  customerName: string | null;
  paymentType: string | null;
  /** Patient's age at the time of the bill (Telo writes the registration value). */
  age: number | null;
  /** Age unit code: 1 Years, 2 Months, 3 Days (matches tbl_med_mcc_patient_master.age_type). */
  ageType: number | null;
}

/** One payment or refund row for a bill (with Telo txn id). */
export interface BillReceiptRow {
  billId: number;
  date: string | null;
  method: string | null;
  reference: string | null;
  txnId: string | null;
  amount: number;
  kind: 'payment' | 'refund';
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

  // Per-MCC receipts in the same window — keyed off recd_date so a payment
  // recorded today rolls up into today's MCC row even if the bill itself
  // was issued days ago. See receipts.ts for the no-backdate invariant.
  const receiptsPromise = getReceiptsInPeriod(scope, fromIso, toIso, {
    byMcc: true,
    mccId: filters.mccId ?? undefined,
  });

  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    // Bind the IST calendar day as a date string and CAST in SQL — binding a
    // JS Date as DATETIME made @from = UTC-midnight = 05:30 IST, which dropped
    // bills stamped 00:00–05:30 IST on the from-day.
    req.input('from', sql.VarChar(10), fromIso);
    req.input('to', sql.VarChar(10), toIso);
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
    // bill_date-keyed roll-up: bills issued in window, what they total,
    // their discount, and current outstanding balance (Balance is a column
    // on the bill row that reflects "as of now"). Money received / refunded
    // in the window is now sourced from the receipts table — see merge below.
    const r = await req.query<{
      mccId: number;
      mccCode: string | null;
      mccName: string | null;
      bills: number;
      charges: number;
      discount: number;
      net: number;
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
      WHERE b.addedby LIKE 'telo:%'
        AND b.bill_date >= CAST(@from AS DATE)
        AND b.bill_date <  DATEADD(day, 1, CAST(@to AS DATE))
        ${scopeClause}
        ${paymentClause}
      GROUP BY m.id, m.MCCUnitCode, m.MCCUnitName
      ORDER BY SUM(ISNULL(b.Balance, 0)) DESC, m.MCCUnitCode
    `);

    const receipts = await receiptsPromise;
    const receiptsByMcc = receipts.byMcc ?? new Map();

    // Union of MCCs: those that had bills issued in the window AND those
    // that had receipts in the window (e.g. only late payments on bills
    // older than @from). The "billed" view is the lead, but a row with
    // received > 0 / refund > 0 from receipts-only is included too.
    const rowsByMcc = new Map<number, AccountsRow>();
    for (const x of r.recordset) {
      const rc = receiptsByMcc.get(x.mccId);
      rowsByMcc.set(x.mccId, {
        mccId: x.mccId,
        mccCode: (x.mccCode ?? '').trim(),
        mccName: x.mccName ? x.mccName.trim() : null,
        bills: Number(x.bills ?? 0),
        charges: Number(x.charges ?? 0),
        discount: Number(x.discount ?? 0),
        net: Number(x.net ?? 0),
        received: rc?.collected ?? 0,
        refund: rc?.refunded ?? 0,
        payingBalance: Number(x.payingBalance ?? 0),
        creditBalance: Number(x.creditBalance ?? 0),
        balance: Number(x.balance ?? 0),
      });
    }
    // Payments-only MCCs (no bills issued in window). We don't have an
    // MCCUnitCode/Name for these without a second lookup; skip them rather
    // than show a half-empty row. The current accounts page presents one
    // row per MCC that issued bills in the window, which matches the LIS
    // "Total" modal semantics. A future "Receipts" view can surface these.

    return Array.from(rowsByMcc.values()).sort(
      (a, b) => b.balance - a.balance || a.mccCode.localeCompare(b.mccCode),
    );
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
      .input('from', sql.VarChar(10), fromIso)
      .input('to', sql.VarChar(10), toIso)
      .query<{
        billId: number;
        billNumber: number | null;
        billDate: Date | null;
        patientName: string | null;
        patientId: number | null;
        amount: number;
        amountPaid: number;
        balance: number;
        doctorName: string | null;
        customerName: string | null;
        paymentType: string | null;
        age: number | null;
        ageType: string | null;
      }>(`
        SELECT
          b.id AS billId, b.bill_number AS billNumber,
          b.bill_date AS billDate, b.patientname AS patientName,
          TRY_CONVERT(INT, b.medid) AS patientId,
          b.amount AS amount, b.amount_paid AS amountPaid,
          b.Balance AS balance,
          d.doctor_name AS doctorName,
          c.customer_name AS customerName,
          b.payment_type AS paymentType,
          b.age AS age,
          b.age_type AS ageType
        FROM dbo.tbl_billing_patient_detail b
        LEFT JOIN dbo.tbl_med_mcc_doctors  d ON d.id = b.ref_doctor
        LEFT JOIN dbo.tbl_med_mcc_customer c ON c.id = b.ref_customer
        WHERE b.addedby LIKE 'telo:%'
          AND b.mcc_code = @mcc
          AND b.bill_date >= CAST(@from AS DATE)
          AND b.bill_date <  DATEADD(day, 1, CAST(@to AS DATE))
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
      doctorName: x.doctorName ? x.doctorName.trim() : null,
      customerName: x.customerName ? x.customerName.trim() : null,
      paymentType: x.paymentType ? x.paymentType.trim() : null,
      age: x.age,
      // age_type is stored as VARCHAR(10) on the bill — parse to int.
      ageType:
        x.ageType != null && /^\d+$/.test(String(x.ageType).trim())
          ? Number(String(x.ageType).trim())
          : null,
    }));
  });
}

/**
 * Free-text search over Telo bills across the caller's full MCC scope within
 * the date window, honouring the same center + payment-mode filters as the
 * rollup. Matches patient name, bill number, ref doctor, or ref customer.
 * Capped at 200 rows. Powers the Accounts page search box.
 */
export async function searchTeloBills(
  scope: number[],
  fromIso: string,
  toIso: string,
  query: string,
  filters: {
    mccId?: number | null;
    paymentMode?: 'cash' | 'credit' | null;
  } = {},
): Promise<PendingBillRow[]> {
  const needle = (query ?? '').trim();
  if (!needle) return [];
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  const unrestricted = ids.length > 1000;

  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('from', sql.VarChar(10), fromIso);
    req.input('to', sql.VarChar(10), toIso);
    // Escape LIKE wildcards in the user's needle so '%'/'_' are literal.
    const escaped = needle.replace(/[[%_]/g, (c) => `[${c}]`);
    req.input('q', sql.NVarChar(120), `%${escaped}%`);

    let scopeClause = unrestricted
      ? ''
      : `AND b.mcc_code IN (${scopeParams(req, ids)})`;
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
      billId: number;
      billNumber: number | null;
      billDate: Date | null;
      patientName: string | null;
      patientId: number | null;
      amount: number;
      amountPaid: number;
      balance: number;
      doctorName: string | null;
      customerName: string | null;
      paymentType: string | null;
      age: number | null;
      ageType: string | null;
    }>(`
      SELECT TOP (200)
        b.id AS billId, b.bill_number AS billNumber,
        b.bill_date AS billDate, b.patientname AS patientName,
        TRY_CONVERT(INT, b.medid) AS patientId,
        b.amount AS amount, b.amount_paid AS amountPaid,
        b.Balance AS balance,
        d.doctor_name AS doctorName,
        c.customer_name AS customerName,
        b.payment_type AS paymentType,
        b.age AS age,
        b.age_type AS ageType
      FROM dbo.tbl_billing_patient_detail b
      LEFT JOIN dbo.tbl_med_mcc_doctors  d ON d.id = b.ref_doctor
      LEFT JOIN dbo.tbl_med_mcc_customer c ON c.id = b.ref_customer
      WHERE b.addedby LIKE 'telo:%'
        AND b.bill_date >= CAST(@from AS DATE)
        AND b.bill_date <  DATEADD(day, 1, CAST(@to AS DATE))
        ${scopeClause}
        ${paymentClause}
        AND (
              b.patientname LIKE @q
           OR CONVERT(VARCHAR(20), b.bill_number) LIKE @q
           OR d.doctor_name LIKE @q
           OR c.customer_name LIKE @q
        )
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
      doctorName: x.doctorName ? x.doctorName.trim() : null,
      customerName: x.customerName ? x.customerName.trim() : null,
      paymentType: x.paymentType ? x.paymentType.trim() : null,
      age: x.age,
      ageType:
        x.ageType != null && /^\d+$/.test(String(x.ageType).trim())
          ? Number(String(x.ageType).trim())
          : null,
    }));
  });
}

/**
 * All payment/refund transactions for the given bill ids (lifetime history).
 * Used by the printable account statement to list txn ids per bill.
 */
export async function listTeloReceiptsForBills(
  billIds: number[],
): Promise<BillReceiptRow[]> {
  const ids = billIds.filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return [];
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    const inClause = ids
      .map((id, i) => {
        req.input(`bid${i}`, sql.Int, id);
        return `@bid${i}`;
      })
      .join(', ');
    const r = await req.query<{
      billId: number;
      date: Date | null;
      method: string | null;
      reference: string | null;
      txnId: string | null;
      amount: number;
      status: string | null;
    }>(`
      SELECT r.bill_id AS billId,
             r.recd_date AS date,
             r.pay_mode AS method,
             r.card_number AS reference,
             t.txn_id AS txnId,
             r.amount,
             r.receive_status AS status
      FROM dbo.tbl_billing_patient_amount_receipt r
      LEFT JOIN dbo.telo_txn t ON t.receipt_id = r.id
      JOIN dbo.tbl_billing_patient_detail b ON b.id = r.bill_id
      WHERE b.addedby LIKE 'telo:%'
        AND r.bill_id IN (${inClause})
      ORDER BY r.bill_id, r.id
    `);
    return r.recordset.map((x) => ({
      billId: x.billId,
      date: x.date ? x.date.toISOString() : null,
      method: x.method?.trim() || null,
      reference: x.reference?.trim() || null,
      txnId: x.txnId?.trim() || null,
      amount: Number(x.amount ?? 0),
      kind: x.status === '2' ? 'refund' as const : 'payment' as const,
    }));
  });
}
