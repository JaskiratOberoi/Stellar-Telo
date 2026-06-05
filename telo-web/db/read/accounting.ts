import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Per-client (single MCC) accounting aggregations for the dashboard at
 * /balances/[mcc]/dashboard. All queries are restricted to Telo-originated
 * bills (`addedby LIKE 'telo:%'`) for one validated `mccId`, date-bounded the
 * same way as db/read/ledger.ts:
 *   bill-keyed:    bill_date >= CAST(@from AS DATE) AND < DATEADD(day,1,CAST(@to AS DATE))
 *   receipt-keyed: recd_date  >= @from            AND < DATEADD(day,1,@to)   (no backdate — see receipts.ts)
 *
 * Scope is enforced one level up (the action validates mccId ∈ caller's MCC
 * scope), so these take a single mccId and bind it directly.
 */

export interface DailyBillRow {
  day: string; // 'YYYY-MM-DD'
  bills: number;
  charges: number;
  discount: number;
  net: number;
  balance: number;
}

export interface DailyCollectionRow {
  day: string; // 'YYYY-MM-DD'
  collected: number;
  cashCollected: number;
  otherCollected: number;
  refunded: number;
  receipts: number;
}

export interface NameAmountRow {
  name: string;
  bills: number;
  charges: number;
}

export interface PaymentModeRow {
  mode: string;
  amount: number;
  count: number;
}

export interface CashCreditSplit {
  cashBills: number;
  cashCharges: number;
  cashBalance: number;
  creditBills: number;
  creditCharges: number;
  creditBalance: number;
}

export interface RegistrarRow {
  username: string | null;
  name: string | null;
  bills: number;
  charges: number;
}

export interface AgingBucket {
  bucket: string; // '0–30', '31–60', '61–90', '90+'
  bills: number;
  balance: number;
}

/** Bind the standard bill-date window onto a request. */
function bindBillWindow(req: sql.Request, mccId: number, fromIso: string, toIso: string) {
  req.input('mcc', sql.Int, mccId);
  req.input('from', sql.VarChar(10), fromIso);
  req.input('to', sql.VarChar(10), toIso);
}

const BILL_WINDOW = `b.addedby LIKE 'telo:%'
  AND b.mcc_code = @mcc
  AND b.bill_date >= CAST(@from AS DATE)
  AND b.bill_date <  DATEADD(day, 1, CAST(@to AS DATE))`;

/** Bills issued per calendar day (bill_date-keyed). */
export async function dailyBillSeries(
  mccId: number,
  fromIso: string,
  toIso: string,
): Promise<DailyBillRow[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    bindBillWindow(req, mccId, fromIso, toIso);
    const r = await req.query<{
      day: string;
      bills: number;
      charges: number;
      discount: number;
      net: number;
      balance: number;
    }>(`
      SELECT
        CONVERT(char(10), CAST(b.bill_date AS DATE), 23) AS day,
        COUNT(*) AS bills,
        SUM(b.amount) AS charges,
        SUM(ISNULL(b.discount_amount, 0)) AS discount,
        SUM(b.amount - ISNULL(b.discount_amount, 0)) AS net,
        SUM(ISNULL(b.Balance, 0)) AS balance
      FROM dbo.tbl_billing_patient_detail b
      WHERE ${BILL_WINDOW}
      GROUP BY CAST(b.bill_date AS DATE)
      ORDER BY day
    `);
    return r.recordset.map((x) => ({
      day: x.day,
      bills: Number(x.bills ?? 0),
      charges: Number(x.charges ?? 0),
      discount: Number(x.discount ?? 0),
      net: Number(x.net ?? 0),
      balance: Number(x.balance ?? 0),
    }));
  });
}

/** Money collected/refunded per calendar day (recd_date-keyed). */
export async function dailyCollectionSeries(
  mccId: number,
  fromIso: string,
  toIso: string,
): Promise<DailyCollectionRow[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('mcc', sql.Int, mccId);
    req.input('from', sql.DateTime, new Date(fromIso));
    req.input('to', sql.DateTime, new Date(toIso));
    const r = await req.query<{
      day: string;
      collected: number;
      cashCollected: number;
      otherCollected: number;
      refunded: number;
      receipts: number;
    }>(`
      SELECT
        CONVERT(char(10), CAST(r.recd_date AS DATE), 23) AS day,
        SUM(CASE WHEN r.receive_status = '1' THEN r.amount ELSE 0 END) AS collected,
        SUM(CASE WHEN r.receive_status = '1' AND r.pay_mode = 'Cash' THEN r.amount ELSE 0 END) AS cashCollected,
        SUM(CASE WHEN r.receive_status = '1' AND (r.pay_mode IS NULL OR r.pay_mode <> 'Cash') THEN r.amount ELSE 0 END) AS otherCollected,
        SUM(CASE WHEN r.receive_status = '2' THEN r.amount ELSE 0 END) AS refunded,
        SUM(CASE WHEN r.receive_status = '1' THEN 1 ELSE 0 END) AS receipts
      FROM dbo.tbl_billing_patient_amount_receipt r
      JOIN dbo.tbl_billing_patient_detail b ON b.id = r.bill_id
      WHERE b.addedby LIKE 'telo:%'
        AND b.mcc_code = @mcc
        AND r.recd_date >= @from
        AND r.recd_date <  DATEADD(day, 1, @to)
      GROUP BY CAST(r.recd_date AS DATE)
      ORDER BY day
    `);
    return r.recordset.map((x) => ({
      day: x.day,
      collected: Number(x.collected ?? 0),
      cashCollected: Number(x.cashCollected ?? 0),
      otherCollected: Number(x.otherCollected ?? 0),
      refunded: Number(x.refunded ?? 0),
      receipts: Number(x.receipts ?? 0),
    }));
  });
}

/** Collections split by payment mode (Cash / UPI / Card / …). */
export async function paymentModeBreakdown(
  mccId: number,
  fromIso: string,
  toIso: string,
): Promise<PaymentModeRow[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('mcc', sql.Int, mccId);
    req.input('from', sql.DateTime, new Date(fromIso));
    req.input('to', sql.DateTime, new Date(toIso));
    const r = await req.query<{ mode: string | null; amount: number; count: number }>(`
      SELECT
        ISNULL(NULLIF(LTRIM(RTRIM(r.pay_mode)), ''), 'Unknown') AS mode,
        SUM(r.amount) AS amount,
        COUNT(*) AS count
      FROM dbo.tbl_billing_patient_amount_receipt r
      JOIN dbo.tbl_billing_patient_detail b ON b.id = r.bill_id
      WHERE b.addedby LIKE 'telo:%'
        AND b.mcc_code = @mcc
        AND r.receive_status = '1'
        AND r.recd_date >= @from
        AND r.recd_date <  DATEADD(day, 1, @to)
      GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(r.pay_mode)), ''), 'Unknown')
      ORDER BY SUM(r.amount) DESC
    `);
    return r.recordset.map((x) => ({
      mode: (x.mode ?? 'Unknown').trim(),
      amount: Number(x.amount ?? 0),
      count: Number(x.count ?? 0),
    }));
  });
}

/** Bills/charges/balance split into Paying vs Credit (payment_type LIKE '%CREDIT%'). */
export async function cashCreditSplit(
  mccId: number,
  fromIso: string,
  toIso: string,
): Promise<CashCreditSplit> {
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    bindBillWindow(req, mccId, fromIso, toIso);
    const r = await req.query<{
      cashBills: number;
      cashCharges: number;
      cashBalance: number;
      creditBills: number;
      creditCharges: number;
      creditBalance: number;
    }>(`
      SELECT
        SUM(CASE WHEN b.payment_type LIKE '%CREDIT%' THEN 0 ELSE 1 END) AS cashBills,
        SUM(CASE WHEN b.payment_type LIKE '%CREDIT%' THEN 0 ELSE b.amount END) AS cashCharges,
        SUM(CASE WHEN b.payment_type LIKE '%CREDIT%' THEN 0 ELSE ISNULL(b.Balance,0) END) AS cashBalance,
        SUM(CASE WHEN b.payment_type LIKE '%CREDIT%' THEN 1 ELSE 0 END) AS creditBills,
        SUM(CASE WHEN b.payment_type LIKE '%CREDIT%' THEN b.amount ELSE 0 END) AS creditCharges,
        SUM(CASE WHEN b.payment_type LIKE '%CREDIT%' THEN ISNULL(b.Balance,0) ELSE 0 END) AS creditBalance
      FROM dbo.tbl_billing_patient_detail b
      WHERE ${BILL_WINDOW}
    `);
    const x = r.recordset[0];
    return {
      cashBills: Number(x?.cashBills ?? 0),
      cashCharges: Number(x?.cashCharges ?? 0),
      cashBalance: Number(x?.cashBalance ?? 0),
      creditBills: Number(x?.creditBills ?? 0),
      creditCharges: Number(x?.creditCharges ?? 0),
      creditBalance: Number(x?.creditBalance ?? 0),
    };
  });
}

/** Top referring doctors by charges in the window. */
export async function topDoctors(
  mccId: number,
  fromIso: string,
  toIso: string,
  topN = 10,
): Promise<NameAmountRow[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    bindBillWindow(req, mccId, fromIso, toIso);
    req.input('topN', sql.Int, topN);
    const r = await req.query<{ name: string | null; bills: number; charges: number }>(`
      SELECT TOP (@topN)
        ISNULL(NULLIF(LTRIM(RTRIM(d.doctor_name)), ''), 'Self / —') AS name,
        COUNT(*) AS bills,
        SUM(b.amount) AS charges
      FROM dbo.tbl_billing_patient_detail b
      LEFT JOIN dbo.tbl_med_mcc_doctors d ON d.id = b.ref_doctor
      WHERE ${BILL_WINDOW}
      GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(d.doctor_name)), ''), 'Self / —')
      ORDER BY SUM(b.amount) DESC
    `);
    return r.recordset.map((x) => ({
      name: (x.name ?? '—').trim(),
      bills: Number(x.bills ?? 0),
      charges: Number(x.charges ?? 0),
    }));
  });
}

/** Top referring customers (MRD / visit source) by charges in the window. */
export async function topCustomers(
  mccId: number,
  fromIso: string,
  toIso: string,
  topN = 10,
): Promise<NameAmountRow[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    bindBillWindow(req, mccId, fromIso, toIso);
    req.input('topN', sql.Int, topN);
    const r = await req.query<{ name: string | null; bills: number; charges: number }>(`
      SELECT TOP (@topN)
        ISNULL(NULLIF(LTRIM(RTRIM(c.customer_name)), ''), '—') AS name,
        COUNT(*) AS bills,
        SUM(b.amount) AS charges
      FROM dbo.tbl_billing_patient_detail b
      LEFT JOIN dbo.tbl_med_mcc_customer c ON c.id = b.ref_customer
      WHERE ${BILL_WINDOW}
      GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(c.customer_name)), ''), '—')
      ORDER BY SUM(b.amount) DESC
    `);
    return r.recordset.map((x) => ({
      name: (x.name ?? '—').trim(),
      bills: Number(x.bills ?? 0),
      charges: Number(x.charges ?? 0),
    }));
  });
}

/**
 * Bills/charges grouped by the Telo account that registered them (resolved
 * from the `addedby='telo:<id>'` marker, like db/read/orders.ts). Lets an
 * admin see which reception account drove a client's billing.
 */
export async function registrarBreakdown(
  mccId: number,
  fromIso: string,
  toIso: string,
  topN = 20,
): Promise<RegistrarRow[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    bindBillWindow(req, mccId, fromIso, toIso);
    req.input('topN', sql.Int, topN);
    const r = await req.query<{
      username: string | null;
      name: string | null;
      bills: number;
      charges: number;
    }>(`
      SELECT TOP (@topN)
        uu.Username AS username,
        NULLIF(LTRIM(RTRIM(CONCAT(uu.firstname, ' ', uu.lastname))), '') AS name,
        COUNT(*) AS bills,
        SUM(b.amount) AS charges
      FROM dbo.tbl_billing_patient_detail b
      LEFT JOIN dbo.tbl_med_user_master uu
        ON uu.id = TRY_CONVERT(INT, STUFF(b.addedby, 1, 5, ''))
      WHERE ${BILL_WINDOW}
      GROUP BY uu.Username, NULLIF(LTRIM(RTRIM(CONCAT(uu.firstname, ' ', uu.lastname))), '')
      ORDER BY SUM(b.amount) DESC
    `);
    return r.recordset.map((x) => ({
      username: x.username?.trim() || null,
      name: x.name?.trim() || null,
      bills: Number(x.bills ?? 0),
      charges: Number(x.charges ?? 0),
    }));
  });
}

/**
 * Outstanding-balance aging AS OF NOW (not date-bounded) for the client:
 * every Telo bill with Balance > 0, bucketed by days since bill_date.
 */
export async function outstandingAging(mccId: number): Promise<AgingBucket[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('mcc', sql.Int, mccId);
    const r = await req.query<{
      b0: number; bal0: number;
      b1: number; bal1: number;
      b2: number; bal2: number;
      b3: number; bal3: number;
    }>(`
      SELECT
        SUM(CASE WHEN dd <= 30 THEN 1 ELSE 0 END) AS b0,
        SUM(CASE WHEN dd <= 30 THEN bal ELSE 0 END) AS bal0,
        SUM(CASE WHEN dd BETWEEN 31 AND 60 THEN 1 ELSE 0 END) AS b1,
        SUM(CASE WHEN dd BETWEEN 31 AND 60 THEN bal ELSE 0 END) AS bal1,
        SUM(CASE WHEN dd BETWEEN 61 AND 90 THEN 1 ELSE 0 END) AS b2,
        SUM(CASE WHEN dd BETWEEN 61 AND 90 THEN bal ELSE 0 END) AS bal2,
        SUM(CASE WHEN dd > 90 THEN 1 ELSE 0 END) AS b3,
        SUM(CASE WHEN dd > 90 THEN bal ELSE 0 END) AS bal3
      FROM (
        SELECT DATEDIFF(day, b.bill_date, GETDATE()) AS dd, ISNULL(b.Balance, 0) AS bal
        FROM dbo.tbl_billing_patient_detail b
        WHERE b.addedby LIKE 'telo:%'
          AND b.mcc_code = @mcc
          AND ISNULL(b.Balance, 0) > 0
      ) t
    `);
    const x = r.recordset[0];
    return [
      { bucket: '0–30', bills: Number(x?.b0 ?? 0), balance: Number(x?.bal0 ?? 0) },
      { bucket: '31–60', bills: Number(x?.b1 ?? 0), balance: Number(x?.bal1 ?? 0) },
      { bucket: '61–90', bills: Number(x?.b2 ?? 0), balance: Number(x?.bal2 ?? 0) },
      { bucket: '90+', bills: Number(x?.b3 ?? 0), balance: Number(x?.bal3 ?? 0) },
    ];
  });
}
