import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Read-only **Sales Data** for one franchise (MCC) — the itemised billable test
 * lines the LIS `Sales/SalesDataforMcc.aspx` screen shows, plus its header
 * totals. Reimplements the legacy `usp_sales_data_for_mcc101` "List" branch as
 * one efficient set-based JOIN (no per-row correlated sub-selects, no
 * sales-user coupling) and the `sp_get_samples_count` / `sp_get_samples_amount`
 * totals.
 *
 * A "sale line" = a billable test (`tbl_med_mcc_patient_tests.amount_checked=1`)
 * dated by the test's `updateddate`, joined to its patient + franchise.
 *
 * Scope is the CALLER's responsibility — the page validates `mccId` is in the
 * user's `getMccScope` before calling (defence-in-depth).
 */

export interface SalesRow {
  /** Patient registration id (LIS regdno). */
  regdNo: number;
  patientName: string | null;
  testCode: string | null;
  testName: string | null;
  amount: number;
  /** Referring doctor (resolved name or free-text), if any. */
  doctor: string | null;
  /** Referring customer/lab (resolved name or free-text), if any. */
  customer: string | null;
}

export interface SalesTotals {
  /** Distinct samples (vailid) with sample_status>1 modified in the window. */
  sampleCount: number;
  /** Σ test_rate for amount_checked lines updated in the window. */
  saleAmount: number;
  /** Total sale lines in the window (the row count across all pages). */
  lineCount: number;
}

const MAX_PAGE_SIZE = 200;

/**
 * Itemised sales lines for one MCC in the date window, paginated. Fetches
 * `pageSize + 1` rows to cheaply detect a next page without a separate COUNT.
 * Bounds: `updateddate` ∈ [from, to] (IST calendar days), mirroring the LIS.
 */
export async function listSalesForMcc(
  mccId: number,
  range: { from: string; to: string },
  opts: { page?: number; pageSize?: number } = {},
): Promise<{ rows: SalesRow[]; hasMore: boolean; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? 100, MAX_PAGE_SIZE));
  if (!Number.isInteger(mccId)) {
    return { rows: [], hasMore: false, page, pageSize };
  }
  const offset = (page - 1) * pageSize;
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('mcc', sql.Int, mccId)
      .input('from', sql.VarChar(10), range.from)
      .input('to', sql.VarChar(10), range.to)
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, pageSize + 1)
      .query<{
        regdNo: number;
        patientName: string | null;
        testCode: string | null;
        testName: string | null;
        amount: number | null;
        doctor: string | null;
        customer: string | null;
      }>(`
        SELECT
          p.id AS regdNo,
          p.name AS patientName,
          t.test_code AS testCode,
          t.test_name AS testName,
          t.test_rate AS amount,
          COALESCE(doc.doctor_name, p.ref_doctor_other) AS doctor,
          COALESCE(cus.customer_name, p.ref_customer_other) AS customer
        FROM dbo.tbl_med_mcc_patient_tests t
        JOIN dbo.tbl_med_mcc_patient_master p ON p.id = t.patient_id
        LEFT JOIN dbo.tbl_med_mcc_doctors  doc ON doc.id = p.ref_doctor
        LEFT JOIN dbo.tbl_med_mcc_customer cus ON cus.id = p.ref_customer
        WHERE p.mcc_code = @mcc
          AND t.amount_checked = 1
          AND t.updateddate >= CAST(@from AS DATE)
          AND t.updateddate <  DATEADD(day, 1, CAST(@to AS DATE))
        ORDER BY t.updateddate DESC, p.id, t.test_code
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);
    const all = r.recordset;
    const hasMore = all.length > pageSize;
    const rows = (hasMore ? all.slice(0, pageSize) : all).map((x) => ({
      regdNo: x.regdNo,
      patientName: x.patientName ? x.patientName.trim() : null,
      testCode: x.testCode ? x.testCode.trim() : null,
      testName: x.testName ? x.testName.trim() : null,
      amount: Number(x.amount ?? 0),
      doctor: x.doctor ? x.doctor.trim() || null : null,
      customer: x.customer ? x.customer.trim() || null : null,
    }));
    return { rows, hasMore, page, pageSize };
  });
}

/**
 * Header totals for the sales screen — distinct sample count + total sale
 * amount in the window. Mirrors LIS `sp_get_samples_count` (samples keyed by
 * `modifieddate`, sample_status>1) and `sp_get_samples_amount` (test_rate keyed
 * by `updateddate`, amount_checked). One round-trip.
 */
export async function getSalesTotals(
  mccId: number,
  range: { from: string; to: string },
): Promise<SalesTotals> {
  if (!Number.isInteger(mccId)) {
    return { sampleCount: 0, saleAmount: 0, lineCount: 0 };
  }
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('mcc', sql.Int, mccId)
      .input('from', sql.VarChar(10), range.from)
      .input('to', sql.VarChar(10), range.to)
      .query<{
        sampleCount: number | null;
        saleAmount: number | null;
        lineCount: number | null;
      }>(`
        SELECT
          (SELECT COUNT(DISTINCT s.vailid)
             FROM dbo.tbl_med_mcc_patient_samples s
             JOIN dbo.tbl_med_mcc_patient_master p ON p.id = s.patient_id
            WHERE p.mcc_code = @mcc
              AND s.sample_status > 1
              AND s.modifieddate >= CAST(@from AS DATE)
              AND s.modifieddate <  DATEADD(day, 1, CAST(@to AS DATE))) AS sampleCount,
          (SELECT SUM(t.test_rate)
             FROM dbo.tbl_med_mcc_patient_tests t
             JOIN dbo.tbl_med_mcc_patient_master p ON p.id = t.patient_id
            WHERE p.mcc_code = @mcc
              AND t.amount_checked = 1
              AND t.updateddate >= CAST(@from AS DATE)
              AND t.updateddate <  DATEADD(day, 1, CAST(@to AS DATE))) AS saleAmount,
          (SELECT COUNT(*)
             FROM dbo.tbl_med_mcc_patient_tests t
             JOIN dbo.tbl_med_mcc_patient_master p ON p.id = t.patient_id
            WHERE p.mcc_code = @mcc
              AND t.amount_checked = 1
              AND t.updateddate >= CAST(@from AS DATE)
              AND t.updateddate <  DATEADD(day, 1, CAST(@to AS DATE))) AS lineCount
      `);
    const x = r.recordset[0] ?? {};
    return {
      sampleCount: Number(x.sampleCount ?? 0),
      saleAmount: Number(x.saleAmount ?? 0),
      lineCount: Number(x.lineCount ?? 0),
    };
  });
}
