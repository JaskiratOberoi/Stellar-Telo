import 'server-only';
import { getPool, sql, withRetry, traceDb } from '@/db/pool';

export interface OrderSummary {
  billId: number;
  billNumber: number | null;
  billDate: string | null;
  patientName: string | null;
  mccCode: number | null;
  amount: number;
  balance: number;
}

export interface OrderLine {
  /** PK of the bill line (tbl_billing_patient_test_detail.id) — the cancel
   *  target for super admins. */
  lineId: number;
  testCode: string | null;
  testName: string | null;
  testType: string | null;
  amount: number;
  /** True once a super admin has cancelled this test line (telo_test_cancellation).
   *  The original line is kept; a negative "(Cancelled)" offset line (amount < 0)
   *  is added alongside it. */
  cancelled: boolean;
  /** True for a Telo-only "external" line (e.g. Glucose - External) — billed by
   *  Noble but performed outside it. Drives the invoice's not-performed-by-Noble
   *  disclaimer. */
  isExternal: boolean;
}

export interface OrderSample {
  vailid: string;
  sampleTypeId: number | null;
  sampleTypeName: string;
  testCodes: string | null;
  status: string | null;
}

/**
 * One row from `tbl_billing_patient_amount_receipt` for a bill — either a
 * payment (kind='payment', from `receive_status='1'`) or a refund
 * (kind='refund', from `receive_status='2'`). `reference` carries the
 * transaction number / cheque no / UPI UTR — stored in the LIS's
 * `card_number` column (column name is legacy, the value is generic).
 */
export interface OrderReceipt {
  /** PK of the receipt row — the void target for super admins. */
  receiptId: number;
  date: string | null;
  amount: number;
  method: string | null;
  reference: string | null;
  txnId: string | null;
  kind: 'payment' | 'refund';
  /** True once a super admin has voided this receipt (telo_receipt_void). The
   *  row is kept for the trail but no longer counts toward amount_paid. */
  voided: boolean;
  /** True once a super admin has edited this receipt's amount
   *  (telo_receipt_edit). The txn id and date are unchanged; `amount` is the
   *  corrected value. Drives the on-screen "modified" badge — the printed
   *  bill deliberately shows no trace of the edit. */
  edited: boolean;
  /** Amount as originally recorded (first edit's old_amount). Null when never
   *  edited. */
  originalAmount: number | null;
  /** Latest edit's metadata for the badge tooltip. Null when never edited. */
  lastEditDate: string | null;
  lastEditBy: string | null;
  lastEditReason: string | null;
}

export interface OrderDetail extends OrderSummary {
  age: number | null;
  /** Age unit: 1 Years, 2 Months, 3 Days (tbl_billing_patient_detail.age_type). */
  ageType: number | null;
  gender: number | null;
  mobile: string | null;
  email: string | null;
  refDoctorName: string | null;
  refCustomerName: string | null; // carries the MRD + (IPD/OPD/ICU) text
  paymentType: string | null;
  clinicalHistory: string | null;
  discount: number;
  amountPaid: number;
  lines: OrderLine[];
  samples: OrderSample[];
  receipts: OrderReceipt[];
  patientId: number | null;
  /** First + last name of the LIS user who registered the bill (from the
   *  `addedby='telo:<id>'` marker). Used as the bill's "Prepared by" for
   *  non-MDCARE clients. Null for non-Telo bills or blank names. */
  preparedByUser: string | null;
  /** Login/account name of the Telo user who registered the bill (the
   *  `tbl_med_user_master.Username` resolved from the `addedby='telo:<id>'`
   *  marker). Multiple accounts can share a client code, so this identifies
   *  exactly which one created the order. Null for non-Telo bills. */
  registeredByUsername: string | null;
  /** Per-account "Prepared By" override (`telo_account.prepared_by`) of the
   *  registering user. When set it wins over `preparedByUser` and the per-MCC
   *  invoice config as the printed "Prepared By". Null = no override. */
  preparedByOverride: string | null;
}

export interface RegistrationSummary {
  patientId: number;
  patientName: string | null;
  mccCode: number | null;
  age: number | null;
  gender: number | null;
  mobile: string | null;
  registeredAt: string | null;
}

export interface SampleAccessionSummary {
  sampleId: number;
  vailid: string;
  patientId: number;
  patientName: string | null;
  mccCode: number | null;
  sampleTypeName: string | null;
  testCodes: string | null;
  status: string | null;
  accessionedAt: string | null;
}

export interface PendingAccession {
  billId: number;
  billNumber: number | null;
  billDate: string | null;
  patientId: number;
  patientName: string | null;
  mccCode: number | null;
  requiredGroups: number;
  haveGroups: number;
  total: number;
  balance: number;
}

/** A sample that HAS its SID but is still 'Sample Sent' — i.e. the barcode is
 *  allotted but the LIS has not registered/received it yet, so it cannot
 *  appear on the worksheet. See listPendingRegistrations. */
export interface PendingRegistration {
  sampleId: number;
  vailid: string;
  statusCode: number | null;
  statusName: string | null;
  patientId: number;
  patientName: string | null;
  /** MCCUnitCode (e.g. "DL0223") — the human client code, not the numeric id. */
  mccCode: string | null;
  /** tbl_med_mcc_unit_master.id — the scope/capability key. */
  mccId: number | null;
  billId: number | null;
  billNumber: number | null;
  sampleTypeName: string | null;
  testCodes: string | null;
  testNames: string | null;
  addedAt: string | null;
}

function scopeParams(
  req: sql.Request,
  scope: number[],
): string {
  return scope
    .map((c, i) => {
      req.input(`s${i}`, sql.Int, c);
      return `@s${i}`;
    })
    .join(',');
}

/**
 * Returns a copy of an order with every monetary field zeroed out and the
 * payment/refund history cleared. Used to gate financial visibility for roles
 * without `bill:view` (e.g. technicians who still need to open the order to
 * accession samples but should never see line totals, balance, discount, or
 * payment ledger). Per-line `amount` is zeroed too — sums must not be
 * reconstructable client-side.
 */
export function redactFinancialFields(order: OrderDetail): OrderDetail {
  return {
    ...order,
    amount: 0,
    balance: 0,
    discount: 0,
    amountPaid: 0,
    receipts: [],
    lines: order.lines.map((l) => ({ ...l, amount: 0 })),
  };
}

/** Recent bills, restricted to the caller's resolved MCC scope (fail-closed). */
export async function listOrders(
  scope: number[],
  limit = 50,
): Promise<OrderSummary[]> {
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  // Unrestricted (Super Admin/Admin) resolves to ~all 1.7k centres. Binding a
  // param per id every poll is wasteful and nears the 2100-param ceiling — at
  // that breadth the scope filter is a no-op, so skip it entirely.
  const unrestricted = ids.length > 1000;
  return traceDb('orders.list', () => withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('lim', sql.Int, Math.min(Math.max(limit, 1), 200));
    const where = unrestricted
      ? ''
      : `WHERE b.mcc_code IN (${scopeParams(req, ids)})`;
    const r = await req.query<{
      billId: number;
      billNumber: number | null;
      billDate: Date | null;
      patientName: string | null;
      mccCode: number | null;
      amount: number;
      balance: number;
    }>(`
      SELECT TOP (@lim)
        b.id AS billId, b.bill_number AS billNumber, b.bill_date AS billDate,
        b.patientname AS patientName, b.mcc_code AS mccCode,
        b.amount AS amount, b.Balance AS balance
      FROM dbo.tbl_billing_patient_detail b
      ${where}
      ORDER BY b.id DESC
    `);
    return r.recordset.map((x) => ({
      billId: x.billId,
      billNumber: x.billNumber,
      billDate: x.billDate ? x.billDate.toISOString() : null,
      patientName: x.patientName,
      mccCode: x.mccCode,
      amount: Number(x.amount ?? 0),
      balance: Number(x.balance ?? 0),
    }));
  }));
}

export async function getOrder(
  billId: number,
  scope: number[],
): Promise<OrderDetail | null> {
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return null;
  const unrestricted = ids.length > 1000; // Super Admin/Admin: skip scope IN
  return traceDb('orders.get', () => withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('bid', sql.Int, billId);
    const scopeClause = unrestricted
      ? ''
      : `AND b.mcc_code IN (${scopeParams(req, ids)})`;
    const head = await req.query<{
      billId: number;
      billNumber: number | null;
      billDate: Date | null;
      patientName: string | null;
      mccCode: number | null;
      amount: number;
      balance: number;
      age: number | null;
      ageType: string | null;
      gender: number | null;
      mobile: string | null;
      email: string | null;
      refDoctorName: string | null;
      refCustomerName: string | null;
      paymentType: string | null;
      clinicalHistory: string | null;
      discount: number;
      amountPaid: number;
      patientId: number | null;
      preparedByUser: string | null;
      registeredByUsername: string | null;
      preparedByOverride: string | null;
    }>(`
      SELECT b.id AS billId, b.bill_number AS billNumber,
             b.bill_date AS billDate, b.patientname AS patientName,
             b.mcc_code AS mccCode, b.amount AS amount, b.Balance AS balance,
             b.age, b.age_type AS ageType, b.gender, b.mobile_number AS mobile, b.email,
             b.payment_type AS paymentType,
             d.doctor_name AS refDoctorName,
             c.customer_name AS refCustomerName,
             p.Clinical_History AS clinicalHistory,
             b.discount_amount AS discount, b.amount_paid AS amountPaid,
             -- Telo writes patient_id into medid so we can join bill→patient.
             TRY_CONVERT(INT, b.medid) AS patientId,
             -- Registering user (addedby='telo:<id>' or 'inf:<id>') → "Prepared by".
             NULLIF(LTRIM(RTRIM(CONCAT(uu.firstname, ' ', uu.lastname))), '') AS preparedByUser,
             -- The exact Telo login that registered the bill (badge on receipt).
             uu.Username AS registeredByUsername,
             -- That user's per-account "Prepared By" override (telo_account).
             ta_u.prepared_by AS preparedByOverride
      FROM dbo.tbl_billing_patient_detail b
      LEFT JOIN dbo.tbl_med_mcc_doctors  d ON d.id = b.ref_doctor
      LEFT JOIN dbo.tbl_med_mcc_customer c ON c.id = b.ref_customer
      LEFT JOIN dbo.tbl_med_mcc_patient_master p
            ON p.id = TRY_CONVERT(INT, b.medid)
      LEFT JOIN dbo.tbl_med_user_master uu
            -- Split on the colon rather than a fixed offset. STUFF(...,1,5,'')
            -- assumed a 5-character 'telo:' prefix; Infinity's 'inf:' is four,
            -- so the old expression silently produced no user for an Infinity
            -- bill and its "Prepared by" came out blank.
            ON (b.addedby LIKE 'telo:%' OR b.addedby LIKE 'inf:%')
           AND uu.id = TRY_CONVERT(INT, SUBSTRING(b.addedby, CHARINDEX(':', b.addedby) + 1, 20))
      LEFT JOIN dbo.telo_account ta_u ON ta_u.user_id = uu.id
      WHERE b.id = @bid ${scopeClause}
    `);
    const h = head.recordset[0];
    if (!h) return null;

    // Fan out the child queries in parallel — lines/receipts/samples are
    // independent of each other (only `samples` even depends on the head
    // result, and only for whether to issue the query). Previous code ran
    // them sequentially = up to 3 × India WAN RTT per order view. Each
    // child opens its own pool.request() so they share the connection pool
    // rather than serializing on a single request.
    const linesPromise = pool
      .request()
      .input('bid', sql.Int, billId)
      .query<{
        lineId: number;
        testCode: string | null;
        testName: string | null;
        testType: string | null;
        amount: number;
        cancelled: number;
        isExternal: number;
      }>(`
        SELECT d.id AS lineId, d.testcode AS testCode, d.testname AS testName,
               d.testtype AS testType, d.testamount AS amount,
               CASE WHEN tc.line_id IS NULL THEN 0 ELSE 1 END AS cancelled,
               -- A Telo-only "external" line (e.g. Glucose - External): billed by
               -- us but performed outside Noble. Flagged from its per-bill log so
               -- the invoice can add the not-performed-by-Noble disclaimer.
               CASE WHEN EXISTS (
                      SELECT 1 FROM dbo.telo_custom_test_order cto
                      WHERE cto.bill_id = d.billid AND LEFT(cto.code, 10) = d.testcode
                    ) THEN 1 ELSE 0 END AS isExternal
        FROM dbo.tbl_billing_patient_test_detail d
        LEFT JOIN dbo.telo_test_cancellation tc ON tc.line_id = d.id
        WHERE d.billid = @bid
        ORDER BY d.id
      `);

    // Per-bill payment + refund history. `card_number` carries the txn
    // ref / cheque no / UPI UTR set by usp_telo_record_receipt and the
    // refund SP — the LIS column name is legacy, the value is generic.
    const receiptsPromise = pool
      .request()
      .input('bid', sql.Int, billId)
      .query<{
        receiptId: number;
        date: Date | null;
        amount: number;
        method: string | null;
        reference: string | null;
        status: string | null;
        txnId: string | null;
        voided: number;
        edited: number;
        originalAmount: number | null;
        lastEditDate: Date | null;
        lastEditBy: string | null;
        lastEditReason: string | null;
      }>(`
        SELECT r.id AS receiptId,
               r.recd_date AS date,
               r.amount,
               r.pay_mode AS method,
               r.card_number AS reference,
               r.receive_status AS status,
               t.txn_id AS txnId,
               CASE WHEN v.receipt_id IS NULL THEN 0 ELSE 1 END AS voided,
               -- Amount-edit trail (telo_receipt_edit): first edit's old_amount
               -- is the amount as originally recorded; the latest edit supplies
               -- the badge tooltip (who / when / why).
               CASE WHEN fe.receipt_id IS NULL THEN 0 ELSE 1 END AS edited,
               fe.old_amount AS originalAmount,
               le.edited_date AS lastEditDate,
               NULLIF(LTRIM(RTRIM(CONCAT(eu.firstname, ' ', eu.lastname))), '') AS lastEditBy,
               le.reason AS lastEditReason
        FROM dbo.tbl_billing_patient_amount_receipt r
        LEFT JOIN dbo.telo_txn t ON t.receipt_id = r.id
        LEFT JOIN dbo.telo_receipt_void v ON v.receipt_id = r.id
        OUTER APPLY (
          SELECT TOP 1 e.receipt_id, e.old_amount
          FROM dbo.telo_receipt_edit e
          WHERE e.receipt_id = r.id
          ORDER BY e.id ASC
        ) fe
        OUTER APPLY (
          SELECT TOP 1 e.edited_date, e.edited_by, e.reason
          FROM dbo.telo_receipt_edit e
          WHERE e.receipt_id = r.id
          ORDER BY e.id DESC
        ) le
        LEFT JOIN dbo.tbl_med_user_master eu ON eu.id = le.edited_by
        WHERE r.bill_id = @bid
        ORDER BY r.id
      `);

    // Samples: only available for Telo-created orders (patient_id in medid).
    const samplesPromise =
      h.patientId != null
        ? pool
            .request()
            .input('pid', sql.Int, h.patientId)
            .query<{
              vailid: string;
              sampleTypeId: number | null;
              sampleTypeName: string | null;
              testCodes: string | null;
              status: string | null;
            }>(`
              SELECT s.vailid,
                     s.sampleid AS sampleTypeId,
                     sm.Sampletype AS sampleTypeName,
                     s.testcodes AS testCodes,
                     st.status AS status
              FROM dbo.tbl_med_mcc_patient_samples s
              LEFT JOIN dbo.tbl_med_sample_master sm ON sm.id = s.sampleid
              LEFT JOIN dbo.tbl_med_mcc_patient_samples_status_master st
                        ON st.id = s.sample_status
              WHERE s.patient_id = @pid
              ORDER BY s.id
            `)
        : Promise.resolve({ recordset: [] as {
            vailid: string;
            sampleTypeId: number | null;
            sampleTypeName: string | null;
            testCodes: string | null;
            status: string | null;
          }[] });

    const [lr, rcr, sr] = await Promise.all([
      linesPromise,
      receiptsPromise,
      samplesPromise,
    ]);

    const receipts: OrderReceipt[] = rcr.recordset.map((x) => ({
      receiptId: x.receiptId,
      date: x.date ? x.date.toISOString() : null,
      amount: Number(x.amount ?? 0),
      method: x.method?.trim() || null,
      reference: x.reference?.trim() || null,
      txnId: x.txnId?.trim() || null,
      kind: x.status === '2' ? 'refund' : 'payment',
      voided: x.voided === 1,
      edited: x.edited === 1,
      originalAmount: x.originalAmount != null ? Number(x.originalAmount) : null,
      lastEditDate: x.lastEditDate ? x.lastEditDate.toISOString() : null,
      lastEditBy: x.lastEditBy?.trim() || null,
      lastEditReason: x.lastEditReason?.trim() || null,
    }));

    const samples: OrderSample[] = sr.recordset.map((x) => ({
      vailid: x.vailid,
      sampleTypeId: x.sampleTypeId,
      sampleTypeName: x.sampleTypeName ?? 'Unspecified',
      testCodes: x.testCodes,
      status: x.status,
    }));

    return {
      billId: h.billId,
      billNumber: h.billNumber,
      billDate: h.billDate ? h.billDate.toISOString() : null,
      patientName: h.patientName,
      mccCode: h.mccCode,
      amount: Number(h.amount ?? 0),
      balance: Number(h.balance ?? 0),
      age: h.age,
      // age_type is stored VARCHAR on the bill — parse to int (1/2/3).
      ageType:
        h.ageType != null && /^\d+$/.test(String(h.ageType).trim())
          ? Number(String(h.ageType).trim())
          : null,
      gender: h.gender,
      mobile: h.mobile,
      email: h.email?.trim() || null,
      refDoctorName: h.refDoctorName?.trim() || null,
      refCustomerName: h.refCustomerName?.trim() || null,
      paymentType: h.paymentType?.trim() || null,
      clinicalHistory: h.clinicalHistory?.trim() || null,
      discount: Number(h.discount ?? 0),
      amountPaid: Number(h.amountPaid ?? 0),
      patientId: h.patientId,
      preparedByUser: h.preparedByUser?.trim() || null,
      registeredByUsername: h.registeredByUsername?.trim() || null,
      preparedByOverride: h.preparedByOverride?.trim() || null,
      lines: lr.recordset.map((x) => ({
        lineId: x.lineId,
        testCode: x.testCode,
        testName: x.testName,
        testType: x.testType,
        amount: Number(x.amount ?? 0),
        cancelled: x.cancelled === 1,
        isExternal: x.isExternal === 1,
      })),
      samples,
      receipts,
    };
  }));
}

/**
 * Recent patient registrations across the caller's scope. This is the
 * highest-throughput stream in Noble (~1.8k–8k/day), so it's the most useful
 * default for a "live" admin feed.
 */
export async function listRegistrations(
  scope: number[],
  limit = 100,
): Promise<RegistrationSummary[]> {
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  const unrestricted = ids.length > 1000;
  return traceDb('orders.listRegistrations', () => withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('lim', sql.Int, Math.min(Math.max(limit, 1), 200));
    const where = unrestricted
      ? ''
      : `WHERE p.mcc_code IN (${scopeParams(req, ids)})`;
    const r = await req.query<{
      patientId: number;
      patientName: string | null;
      mccCode: number | null;
      age: number | null;
      gender: number | null;
      mobile: string | null;
      registeredAt: Date | null;
    }>(`
      SELECT TOP (@lim)
        p.id AS patientId, p.name AS patientName, p.mcc_code AS mccCode,
        p.age, p.gender, p.mobile_number AS mobile,
        p.addeddate AS registeredAt
      FROM dbo.tbl_med_mcc_patient_master p
      ${where}
      ORDER BY p.id DESC
    `);
    return r.recordset.map((x) => ({
      patientId: x.patientId,
      patientName: x.patientName,
      mccCode: x.mccCode,
      age: x.age,
      gender: x.gender,
      mobile: x.mobile,
      registeredAt: x.registeredAt ? x.registeredAt.toISOString() : null,
    }));
  }));
}

export interface PatientTestItem {
  id: number;
  kind: 'test' | 'profile' | 'master';
  code: string;
  name: string;
}

/**
 * The test/profile lines on a patient, rebuilt as catalog-item shapes — used
 * to recompute the order's sample groups on the accession page.
 */
export async function fetchPatientTestItems(
  patientId: number,
): Promise<PatientTestItem[]> {
  if (!Number.isInteger(patientId)) return [];
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('pid', sql.Int, patientId)
      .query<{
        id: number;
        testType: string | null;
        code: string | null;
        name: string | null;
      }>(`
        SELECT test_id AS id, test_type AS testType,
               test_code AS code, test_name AS name
        FROM dbo.tbl_med_mcc_patient_tests
        WHERE patient_id = @pid
        ORDER BY id
      `);
    return r.recordset.map((x) => ({
      id: x.id,
      // test_type is the LIS enum on new orders ('Profile'/'Test'/'Master'),
      // 'p'/'t' on orders registered before the sales-visibility change.
      kind:
        x.testType === 'Master'
          ? ('master' as const)
          : x.testType === 'p' || x.testType === 'Profile'
            ? ('profile' as const)
            : ('test' as const),
      code: (x.code ?? '').trim() || String(x.id),
      name: (x.name ?? x.code ?? '').trim() || String(x.id),
    }));
  });
}

/**
 * Telo orders still awaiting accessioning — registered with fewer Sample IDs
 * than the order's tests require. `requiredGroups` is the count of distinct
 * sample types the tests resolve to (mirrors usp_telo_create_order's grouping:
 * non-profile tests' SampleId ∪ profile constituents' SampleId, IsActive=1,
 * NULL bucketed as -1). `haveGroups` is the count of sample rows written so
 * far. An order drops off this list once have == required.
 */
export async function listPendingAccessions(
  scope: number[],
  /** Which order type to list: 'new' excludes B2B orders, 'b2b' shows only
   *  them, 'all' shows both. B2B orders are tagged in telo_order_kind. */
  kind: 'new' | 'b2b' | 'all' = 'all',
): Promise<PendingAccession[]> {
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  const unrestricted = ids.length > 1000;
  return traceDb('orders.listPendingAccessions', () => withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    const scopeClause = unrestricted
      ? ''
      : `AND b.mcc_code IN (${scopeParams(req, ids)})`;
    // New-order worklist excludes B2B-tagged bills; B2B worklist shows only them.
    const kindClause =
      kind === 'b2b'
        ? `AND b.id IN (SELECT bill_id FROM dbo.telo_order_kind WHERE kind = 'b2b')`
        : kind === 'new'
          ? `AND b.id NOT IN (SELECT bill_id FROM dbo.telo_order_kind WHERE kind = 'b2b')`
          : '';
    const r = await req.query<{
      billId: number;
      billNumber: number | null;
      billDate: Date | null;
      patientId: number;
      patientName: string | null;
      mccCode: number | null;
      requiredGroups: number;
      haveGroups: number;
      total: number;
      balance: number;
    }>(`
      WITH telo AS (
        SELECT b.id AS billId, b.bill_number AS billNumber,
               b.bill_date AS billDate, TRY_CONVERT(INT, b.medid) AS patientId,
               b.patientname AS patientName, b.mcc_code AS mccCode,
               b.amount AS total, b.Balance AS balance
        FROM dbo.tbl_billing_patient_detail b
        -- telo: OR inf:. Stellar Infinity books orders into the same tables and
        -- stamps 'inf:<id>'. Matching only telo: would leave an Infinity order
        -- invisible in this queue, so nobody here would ever allot its barcode
        -- and its sample would sit unaccessioned with nothing reporting it.
        -- The lab is one lab; both platforms' orders belong in one queue.
        -- Native LIS orders stay excluded — they are accessioned in the LIS.
        WHERE (b.addedby LIKE 'telo:%' OR b.addedby LIKE 'inf:%')
          AND TRY_CONVERT(INT, b.medid) IS NOT NULL
          ${scopeClause}
          ${kindClause}
      )
      SELECT t.billId, t.billNumber, t.billDate, t.patientId,
             t.patientName, t.mccCode, t.total, t.balance,
             req.requiredGroups,
             ISNULL(h.haveGroups, 0) AS haveGroups
      FROM telo t
      CROSS APPLY (
        SELECT COUNT(DISTINCT x.sampleTypeId) AS requiredGroups
        FROM (
          -- test_type: 'Profile'/'Test'/'Master' (LIS enum) on new orders,
          -- 'p'/'t' on orders from before the sales-visibility change.
          -- Direct tests
          SELECT ISNULL(tm.SampleId, -1) AS sampleTypeId
          FROM dbo.tbl_med_mcc_patient_tests pt
          JOIN dbo.tbl_med_test_master tm
            ON tm.id = pt.test_id AND tm.IsActive = 1
          WHERE pt.patient_id = t.patientId
            AND pt.test_type NOT IN ('p', 'Profile', 'Master')
          UNION ALL
          -- Direct profiles → constituent tests
          SELECT ISNULL(tm.SampleId, -1)
          FROM dbo.tbl_med_mcc_patient_tests pt
          JOIN dbo.tbl_med_test_profile_param pp ON pp.profileid = pt.test_id
          JOIN dbo.tbl_med_test_master tm
            ON tm.id = pp.testid AND tm.IsActive = 1
          WHERE pt.patient_id = t.patientId
            AND pt.test_type IN ('p', 'Profile')
          UNION ALL
          -- Master → child tests
          SELECT ISNULL(tm.SampleId, -1)
          FROM dbo.tbl_med_mcc_patient_tests pt
          JOIN dbo.tbl_med_test_master_test_param mtp ON mtp.master_profileid = pt.test_id
          JOIN dbo.tbl_med_test_master tm
            ON tm.id = mtp.testid AND tm.IsActive = 1
          WHERE pt.patient_id = t.patientId
            AND pt.test_type = 'Master'
          UNION ALL
          -- Master → child profiles → constituent tests
          SELECT ISNULL(tm.SampleId, -1)
          FROM dbo.tbl_med_mcc_patient_tests pt
          JOIN dbo.tbl_med_test_master_profile_param mpp ON mpp.master_profileid = pt.test_id
          JOIN dbo.tbl_med_test_profile_param pp ON pp.profileid = mpp.profileid
          JOIN dbo.tbl_med_test_master tm
            ON tm.id = pp.testid AND tm.IsActive = 1
          WHERE pt.patient_id = t.patientId
            AND pt.test_type = 'Master'
        ) x
      ) req
      OUTER APPLY (
        SELECT COUNT(*) AS haveGroups
        FROM dbo.tbl_med_mcc_patient_samples s
        WHERE s.patient_id = t.patientId
      ) h
      WHERE req.requiredGroups > ISNULL(h.haveGroups, 0)
      ORDER BY t.billId DESC
    `);
    return r.recordset.map((x) => ({
      billId: x.billId,
      billNumber: x.billNumber,
      billDate: x.billDate ? x.billDate.toISOString() : null,
      patientId: x.patientId,
      patientName: x.patientName ? x.patientName.trim() : null,
      mccCode: x.mccCode,
      requiredGroups: Number(x.requiredGroups ?? 0),
      haveGroups: Number(x.haveGroups ?? 0),
      total: Number(x.total ?? 0),
      balance: Number(x.balance ?? 0),
    }));
  }));
}

/**
 * Telo samples that HAVE a Sample ID but are still awaiting accessioning in
 * the LIS — the second half of the worklist.
 *
 * Every sample Telo writes (both `usp_telo_create_order` and
 * `usp_telo_add_sids`) starts at `sample_status = 1` ("Sample Sent"), exactly
 * like a native LIS registration. The LIS's own receive/accession step is what
 * advances it to 2 ("Sample Registered") and beyond. The worksheet SP filters
 * `sample_status > 1`, so anything still at 1 is invisible on the worksheet —
 * which is precisely the queue this lists: barcode allotted, not yet received.
 *
 * `< 2` rather than `= 1` so a NULL/0 status (bad legacy row) surfaces here
 * instead of silently vanishing from both worklists.
 *
 * Driven from the telo bill set (same shape as listPendingAccessions) so the
 * scope + kind filters and the query plan stay consistent between the two.
 */
export async function listPendingRegistrations(
  scope: number[],
  /** Which order type to list — mirrors listPendingAccessions. */
  kind: 'new' | 'b2b' | 'all' = 'all',
  limit = 500,
): Promise<PendingRegistration[]> {
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  const unrestricted = ids.length > 1000;
  return traceDb('orders.listPendingRegistrations', () => withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('lim', sql.Int, Math.min(Math.max(limit, 1), 1000));
    const scopeClause = unrestricted
      ? ''
      : `AND b.mcc_code IN (${scopeParams(req, ids)})`;
    const kindClause =
      kind === 'b2b'
        ? `AND b.id IN (SELECT bill_id FROM dbo.telo_order_kind WHERE kind = 'b2b')`
        : kind === 'new'
          ? `AND b.id NOT IN (SELECT bill_id FROM dbo.telo_order_kind WHERE kind = 'b2b')`
          : '';
    const r = await req.query<{
      sampleId: number;
      vailid: string;
      statusCode: number | null;
      statusName: string | null;
      patientId: number;
      patientName: string | null;
      mccCode: string | null;
      mccId: number | null;
      billId: number | null;
      billNumber: number | null;
      sampleTypeName: string | null;
      testCodes: string | null;
      testNames: string | null;
      addedAt: Date | null;
    }>(`
      WITH telo AS (
        SELECT b.id AS billId, b.bill_number AS billNumber,
               TRY_CONVERT(INT, b.medid) AS patientId,
               b.patientname AS patientName, b.mcc_code AS mccId
        FROM dbo.tbl_billing_patient_detail b
        -- telo: OR inf: — see the note on the pending-accessions query above.
        WHERE (b.addedby LIKE 'telo:%' OR b.addedby LIKE 'inf:%')
          AND TRY_CONVERT(INT, b.medid) IS NOT NULL
          ${scopeClause}
          ${kindClause}
      )
      SELECT TOP (@lim)
        s.id AS sampleId, s.vailid,
        s.sample_status AS statusCode,
        st.status AS statusName,
        t.patientId, t.patientName,
        u.MCCUnitCode AS mccCode, t.mccId,
        t.billId, t.billNumber,
        sm.Sampletype AS sampleTypeName,
        s.testcodes AS testCodes,
        s.testnames AS testNames,
        s.addeddate AS addedAt
      FROM telo t
      JOIN dbo.tbl_med_mcc_patient_samples s ON s.patient_id = t.patientId
      LEFT JOIN dbo.tbl_med_mcc_patient_samples_status_master st
        ON st.id = s.sample_status
      LEFT JOIN dbo.tbl_med_mcc_unit_master u ON u.id = t.mccId
      LEFT JOIN dbo.tbl_med_sample_master sm ON sm.id = s.sampleid
      WHERE ISNULL(s.sample_status, 0) < 2
      ORDER BY s.id DESC
    `);
    return r.recordset.map((x) => ({
      sampleId: x.sampleId,
      vailid: (x.vailid ?? '').trim(),
      statusCode: x.statusCode ?? null,
      statusName: x.statusName ? x.statusName.trim() : null,
      patientId: x.patientId,
      patientName: x.patientName ? x.patientName.trim() : null,
      // MCCUnitCode carries legacy trailing spaces — trim for display.
      mccCode: x.mccCode ? x.mccCode.trim() : null,
      mccId: x.mccId ?? null,
      billId: x.billId ?? null,
      billNumber: x.billNumber ?? null,
      sampleTypeName: x.sampleTypeName ? x.sampleTypeName.trim() : null,
      testCodes: x.testCodes ? x.testCodes.trim() : null,
      testNames: x.testNames ? x.testNames.trim() : null,
      addedAt: x.addedAt ? x.addedAt.toISOString() : null,
    }));
  }));
}

/** Recent sample accessions (each barcode that hit the LIS), scope-aware. */
export async function listSampleAccessions(
  scope: number[],
  limit = 100,
): Promise<SampleAccessionSummary[]> {
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  const unrestricted = ids.length > 1000;
  return traceDb('orders.listSampleAccessions', () => withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('lim', sql.Int, Math.min(Math.max(limit, 1), 200));
    const where = unrestricted
      ? ''
      : `WHERE p.mcc_code IN (${scopeParams(req, ids)})`;
    const r = await req.query<{
      sampleId: number;
      vailid: string;
      patientId: number;
      patientName: string | null;
      mccCode: number | null;
      sampleTypeName: string | null;
      testCodes: string | null;
      status: string | null;
      accessionedAt: Date | null;
    }>(`
      SELECT TOP (@lim)
        s.id AS sampleId, s.vailid, s.patient_id AS patientId,
        p.name AS patientName, p.mcc_code AS mccCode,
        sm.Sampletype AS sampleTypeName,
        s.testcodes AS testCodes,
        st.status AS status,
        s.addeddate AS accessionedAt
      FROM dbo.tbl_med_mcc_patient_samples s
      JOIN dbo.tbl_med_mcc_patient_master p ON p.id = s.patient_id
      LEFT JOIN dbo.tbl_med_sample_master sm ON sm.id = s.sampleid
      LEFT JOIN dbo.tbl_med_mcc_patient_samples_status_master st
                ON st.id = s.sample_status
      ${where}
      ORDER BY s.id DESC
    `);
    return r.recordset.map((x) => ({
      sampleId: x.sampleId,
      vailid: x.vailid,
      patientId: x.patientId,
      patientName: x.patientName,
      mccCode: x.mccCode,
      sampleTypeName: x.sampleTypeName,
      testCodes: x.testCodes,
      status: x.status,
      accessionedAt: x.accessionedAt ? x.accessionedAt.toISOString() : null,
    }));
  }));
}
