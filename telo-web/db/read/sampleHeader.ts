import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Lightweight report header for one exact SID — the fast path behind the report
 * preview / PDF / lock / scope checks.
 *
 * Why this exists: those paths used to resolve a SID through the Listec
 * worksheet SP (`usp_listec_worksheet_report_json`), whose SID filter is a
 * leading-wildcard `vailid LIKE '%sid%'` — unindexable — and which builds a
 * per-row JSON payload of every result. The lock/scope callers handed it a
 * 2015→2100 window, so every preview open ran multiple full scans of the
 * samples table. This module answers the same "who/what is this SID" question
 * with ONE exact-match query (`S.vailid = @sid`) and none of the JSON work.
 * Header fields and value shapes mirror the SP's `H` CTE exactly.
 *
 * Date fields follow the LISTEC CONVENTION (see lib/datetime.ts): naive LIS
 * datetimes (IST wall-clock) are emitted as that wall-clock stamped `Z`, so the
 * report keeps formatting them with fmtListec unchanged. We CONVERT to a string
 * in SQL (style 126) and append 'Z' here — deliberately BYPASSING the driver's
 * useUTC handling so the encoding never depends on the container timezone.
 */
export interface SampleHeader {
  sid: string;
  pid: number;
  patient_name: string | null;
  sex: string | null;
  age: number | null;
  age_unit: string | null;
  client_code: string | null;
  business_unit: string | null;
  /** IST wall-clock re-encoded as `...Z` — format with fmtListec. */
  sample_drawn: string | null;
  regd_at: string | null;
  last_modified_at: string | null;
  status: string | null;
  bill_number: string | null;
  clinical_history: string | null;
  /** patient_master.MRNID — carries the B2B passport / travel ID. */
  mrn_id: string | null;
}

interface RawHeader {
  sid: string;
  pid: number;
  patient_name: string | null;
  sex: string | null;
  age: number | null;
  age_unit: string | null;
  client_code: string | null;
  business_unit: string | null;
  sample_drawn: string | null;
  regd_at: string | null;
  last_modified_at: string | null;
  status: string | null;
  bill_number: string | null;
  clinical_history: string | null;
  /** patient_master.MRNID — carries the B2B passport / travel ID. */
  mrn_id: string | null;
}

/** Wall-clock ISO string (style 126, no offset) → Listec-convention `...Z`. */
const zStamp = (s: string | null) => (s ? `${s}Z` : null);

/**
 * All sample rows for an EXACT SID (normally one; defensively capped). Mirrors
 * the worksheet SP's visibility rule (`sample_status > 1` — registered-only
 * samples are not reportable) so swapping data sources changes no outcomes.
 */
export async function getSampleHeaders(sid: string): Promise<SampleHeader[]> {
  const target = (sid ?? '').trim();
  if (!target) return [];
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('sid', sql.NVarChar(50), target)
      .query<RawHeader>(`
        SELECT TOP (5)
          S.vailid AS sid,
          P.id AS pid,
          P.name AS patient_name,
          CASE P.gender WHEN 1 THEN 'Male' ELSE 'Female' END AS sex,
          P.age,
          CASE P.age_type
            WHEN 1 THEN 'Year(s)'
            WHEN 2 THEN 'Month(s)'
            WHEN 3 THEN 'Day(s)'
            ELSE 'Unknown'
          END AS age_unit,
          U.MCCUnitCode AS client_code,
          BU.BusinessUnitCode AS business_unit,
          CONVERT(VARCHAR(23), P.sample_time, 126)      AS sample_drawn,
          CONVERT(VARCHAR(23), S.modifieddate, 126)     AS regd_at,
          CONVERT(VARCHAR(23), S.lastmodified_date, 126) AS last_modified_at,
          STAT.status AS status,
          P.bill_number,
          S.Sample_ClinicalHistory AS clinical_history,
          P.MRNID AS mrn_id
        FROM dbo.tbl_med_mcc_patient_samples S
        INNER JOIN dbo.tbl_med_mcc_patient_master P ON S.patient_id = P.id
        INNER JOIN dbo.tbl_med_mcc_unit_master U ON P.mcc_code = U.id
        LEFT JOIN dbo.tbl_med_business_unit_master BU ON BU.id = S.business_unit_id
        LEFT JOIN dbo.tbl_med_mcc_patient_samples_status_master STAT
          ON STAT.id = S.sample_status
        WHERE S.vailid = @sid AND S.sample_status > 1
        ORDER BY S.modifieddate DESC
      `);
    return r.recordset.map((x) => ({
      ...x,
      sample_drawn: zStamp(x.sample_drawn),
      regd_at: zStamp(x.regd_at),
      last_modified_at: zStamp(x.last_modified_at),
    }));
  });
}

/** The single header row for a SID (newest if the SID ever duplicated), or null. */
export async function getSampleHeader(sid: string): Promise<SampleHeader | null> {
  const rows = await getSampleHeaders(sid);
  return rows[0] ?? null;
}
