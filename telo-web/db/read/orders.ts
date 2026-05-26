import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

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
  testCode: string | null;
  testName: string | null;
  testType: string | null;
  amount: number;
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
  date: string | null;
  amount: number;
  method: string | null;
  reference: string | null;
  kind: 'payment' | 'refund';
}

export interface OrderDetail extends OrderSummary {
  age: number | null;
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
  return withRetry(async () => {
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
  });
}

export async function getOrder(
  billId: number,
  scope: number[],
): Promise<OrderDetail | null> {
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return null;
  const unrestricted = ids.length > 1000; // Super Admin/Admin: skip scope IN
  return withRetry(async () => {
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
    }>(`
      SELECT b.id AS billId, b.bill_number AS billNumber,
             b.bill_date AS billDate, b.patientname AS patientName,
             b.mcc_code AS mccCode, b.amount AS amount, b.Balance AS balance,
             b.age, b.gender, b.mobile_number AS mobile, b.email,
             b.payment_type AS paymentType,
             d.doctor_name AS refDoctorName,
             c.customer_name AS refCustomerName,
             p.Clinical_History AS clinicalHistory,
             b.discount_amount AS discount, b.amount_paid AS amountPaid,
             -- Telo writes patient_id into medid so we can join bill→patient.
             TRY_CONVERT(INT, b.medid) AS patientId
      FROM dbo.tbl_billing_patient_detail b
      LEFT JOIN dbo.tbl_med_mcc_doctors  d ON d.id = b.ref_doctor
      LEFT JOIN dbo.tbl_med_mcc_customer c ON c.id = b.ref_customer
      LEFT JOIN dbo.tbl_med_mcc_patient_master p
            ON p.id = TRY_CONVERT(INT, b.medid)
      WHERE b.id = @bid ${scopeClause}
    `);
    const h = head.recordset[0];
    if (!h) return null;

    const linesReq = pool.request().input('bid', sql.Int, billId);
    const lr = await linesReq.query<{
      testCode: string | null;
      testName: string | null;
      testType: string | null;
      amount: number;
    }>(`
      SELECT testcode AS testCode, testname AS testName,
             testtype AS testType, testamount AS amount
      FROM dbo.tbl_billing_patient_test_detail
      WHERE billid = @bid
      ORDER BY id
    `);

    // Per-bill payment + refund history. `card_number` carries the txn
    // ref / cheque no / UPI UTR set by usp_telo_record_receipt and the
    // refund SP — the LIS column name is legacy, the value is generic.
    const rcReq = pool.request().input('bid', sql.Int, billId);
    const rcr = await rcReq.query<{
      date: Date | null;
      amount: number;
      method: string | null;
      reference: string | null;
      status: string | null;
    }>(`
      SELECT recd_date AS date,
             amount,
             pay_mode AS method,
             card_number AS reference,
             receive_status AS status
      FROM dbo.tbl_billing_patient_amount_receipt
      WHERE bill_id = @bid
      ORDER BY id
    `);
    const receipts: OrderReceipt[] = rcr.recordset.map((x) => ({
      date: x.date ? x.date.toISOString() : null,
      amount: Number(x.amount ?? 0),
      method: x.method?.trim() || null,
      reference: x.reference?.trim() || null,
      kind: x.status === '2' ? 'refund' : 'payment',
    }));

    // Samples: only available for Telo-created orders (patient_id in medid).
    let samples: OrderSample[] = [];
    if (h.patientId != null) {
      const sReq = pool.request().input('pid', sql.Int, h.patientId);
      const sr = await sReq.query<{
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
      `);
      samples = sr.recordset.map((x) => ({
        vailid: x.vailid,
        sampleTypeId: x.sampleTypeId,
        sampleTypeName: x.sampleTypeName ?? 'Unspecified',
        testCodes: x.testCodes,
        status: x.status,
      }));
    }

    return {
      billId: h.billId,
      billNumber: h.billNumber,
      billDate: h.billDate ? h.billDate.toISOString() : null,
      patientName: h.patientName,
      mccCode: h.mccCode,
      amount: Number(h.amount ?? 0),
      balance: Number(h.balance ?? 0),
      age: h.age,
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
      lines: lr.recordset.map((x) => ({
        testCode: x.testCode,
        testName: x.testName,
        testType: x.testType,
        amount: Number(x.amount ?? 0),
      })),
      samples,
      receipts,
    };
  });
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
  return withRetry(async () => {
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
  });
}

export interface PatientTestItem {
  id: number;
  kind: 'test' | 'profile';
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
      // test_type is 'Profile'/'Test' (LIS enum) on new orders, 'p'/'t' on
      // orders registered before the sales-visibility change.
      kind:
        x.testType === 'p' || x.testType === 'Profile'
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
): Promise<PendingAccession[]> {
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  const unrestricted = ids.length > 1000;
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    const scopeClause = unrestricted
      ? ''
      : `AND b.mcc_code IN (${scopeParams(req, ids)})`;
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
        WHERE b.addedby LIKE 'telo:%'
          AND TRY_CONVERT(INT, b.medid) IS NOT NULL
          ${scopeClause}
      )
      SELECT t.billId, t.billNumber, t.billDate, t.patientId,
             t.patientName, t.mccCode, t.total, t.balance,
             req.requiredGroups,
             ISNULL(h.haveGroups, 0) AS haveGroups
      FROM telo t
      CROSS APPLY (
        SELECT COUNT(DISTINCT x.sampleTypeId) AS requiredGroups
        FROM (
          -- test_type: 'Profile'/'Test' (LIS enum) on new orders,
          -- 'p'/'t' on orders from before the sales-visibility change.
          SELECT ISNULL(tm.SampleId, -1) AS sampleTypeId
          FROM dbo.tbl_med_mcc_patient_tests pt
          JOIN dbo.tbl_med_test_master tm
            ON tm.id = pt.test_id AND tm.IsActive = 1
          WHERE pt.patient_id = t.patientId
            AND pt.test_type NOT IN ('p', 'Profile')
          UNION ALL
          SELECT ISNULL(tm.SampleId, -1)
          FROM dbo.tbl_med_mcc_patient_tests pt
          JOIN dbo.tbl_med_test_profile_param pp ON pp.profileid = pt.test_id
          JOIN dbo.tbl_med_test_master tm
            ON tm.id = pp.testid AND tm.IsActive = 1
          WHERE pt.patient_id = t.patientId
            AND pt.test_type IN ('p', 'Profile')
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
  });
}

/** Recent sample accessions (each barcode that hit the LIS), scope-aware. */
export async function listSampleAccessions(
  scope: number[],
  limit = 100,
): Promise<SampleAccessionSummary[]> {
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  const unrestricted = ids.length > 1000;
  return withRetry(async () => {
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
  });
}
