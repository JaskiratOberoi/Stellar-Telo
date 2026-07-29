import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Full-range text search for the Reporting tab.
 *
 * Why this exists: the universal search box used to match in Node against a
 * single page-capped window of worksheet rows (`pageSize: 1000`). A month-wide
 * range across every business unit holds 12,000+ samples, so anything outside
 * the first 1,000 was invisible — searching "HR204A" found nothing until you
 * also picked its business unit, which shrank the window enough to include it.
 * Paging the worksheet SP instead is not an option: each 1,000-row page costs
 * ~7-8s (it builds per-row result JSON), so a full sweep is 90s+.
 *
 * The fix is to push the match into SQL. Everything the search box looks at is
 * already denormalised onto the samples row — including `S.testnames`, the same
 * column the worksheet SP surfaces as `test_names_csv` — so one indexed-ish
 * query over the date window answers it in well under a second.
 *
 * Header fields and value shapes mirror the worksheet SP's `H` CTE exactly, so
 * rows built here are interchangeable with rows that came from the SP.
 *
 * Date fields follow the LISTEC CONVENTION (see lib/datetime.ts): naive LIS
 * datetimes (IST wall-clock) are emitted as that wall-clock stamped `Z`.
 */

export interface ReportSearchHit {
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
  test_names_csv: string | null;
  bill_number: string | null;
}

interface RawHit extends Omit<ReportSearchHit, 'sample_drawn' | 'regd_at' | 'last_modified_at'> {
  sample_drawn: string | null;
  regd_at: string | null;
  last_modified_at: string | null;
}

/** Wall-clock ISO string (style 126, no offset) → Listec-convention `...Z`. */
const zStamp = (s: string | null) => (s ? `${s}Z` : null);

export interface ReportSearchOptions {
  /** 'YYYY-MM-DD' (inclusive). */
  from: string;
  to: string;
  /** The universal query — matched across patient, SID, PID, client, bill# and
   *  the sample's test-name CSV (which carries package labels like
   *  "[HR204A HEALTH PACKAGE]"). */
  q: string;
  /** Restrict to these client codes (the caller's report scope). `null` =
   *  unrestricted. An empty array means "nothing visible" and returns []. */
  clientCodes: string[] | null;
  /** Optional business-unit CODE filter, as shown in the UI dropdown. */
  businessUnit?: string | null;
  /** Optional exact client code typed in the filter box. */
  clientCode?: string | null;
  /** Safety cap on rows returned. */
  limit?: number;
}

/**
 * SIDs in the window whose searchable text matches `q`. Returns at most `limit`
 * rows, newest first, so a very broad query can't drag the whole month back.
 */
export async function searchReportSamples(
  opts: ReportSearchOptions,
): Promise<ReportSearchHit[]> {
  const q = (opts.q ?? '').trim();
  if (!q) return [];
  if (opts.clientCodes !== null && opts.clientCodes.length === 0) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000));

  // LIKE metacharacters are stripped rather than escaped — the search box is a
  // plain contains-match, so '%' / '_' / '[' carry no user intent here.
  const safe = q.replace(/[%_[\]]/g, ' ').slice(0, 100);
  const numeric = /^\d+$/.test(q);

  return withRetry(async () => {
    const pool = await getPool();
    const req = pool
      .request()
      .input('q', sql.NVarChar(120), `%${safe}%`)
      .input('from', sql.VarChar(10), opts.from)
      .input('to', sql.VarChar(10), opts.to)
      .input('lim', sql.Int, limit)
      .input('pidExact', sql.Int, numeric ? Number(q) : null);

    // Scope: bind each allowed client code as its own parameter.
    let scopeClause = '';
    if (opts.clientCodes !== null) {
      const params = opts.clientCodes.slice(0, 500).map((code, i) => {
        req.input(`sc${i}`, sql.NVarChar(50), code);
        return `@sc${i}`;
      });
      scopeClause = params.length
        ? `AND UPPER(LTRIM(RTRIM(U.MCCUnitCode))) IN (${params.join(',')})`
        : 'AND 1 = 0';
    }

    let clientClause = '';
    const typed = (opts.clientCode ?? '').trim();
    if (typed) {
      req.input('cc', sql.NVarChar(50), typed);
      clientClause = 'AND U.MCCUnitCode = @cc';
    }

    let buClause = '';
    const bu = (opts.businessUnit ?? '').trim();
    if (bu) {
      req.input('bu', sql.NVarChar(50), bu);
      buClause = 'AND BU.BusinessUnitCode = @bu';
    }

    const r = await req.query<RawHit>(`
      SELECT TOP (@lim)
        S.vailid                                        AS sid,
        P.id                                            AS pid,
        P.name                                          AS patient_name,
        CASE P.gender WHEN 1 THEN 'Male' ELSE 'Female' END AS sex,
        P.age,
        CASE P.age_type
          WHEN 1 THEN 'Year(s)'
          WHEN 2 THEN 'Month(s)'
          WHEN 3 THEN 'Day(s)'
          ELSE 'Unknown'
        END                                             AS age_unit,
        U.MCCUnitCode                                   AS client_code,
        BU.BusinessUnitCode                             AS business_unit,
        CONVERT(VARCHAR(23), P.sample_time, 126)        AS sample_drawn,
        CONVERT(VARCHAR(23), S.modifieddate, 126)       AS regd_at,
        CONVERT(VARCHAR(23), S.lastmodified_date, 126)  AS last_modified_at,
        STAT.status                                     AS status,
        S.testnames                                     AS test_names_csv,
        P.bill_number
      FROM dbo.tbl_med_mcc_patient_samples S
      INNER JOIN dbo.tbl_med_mcc_patient_master P ON S.patient_id = P.id
      INNER JOIN dbo.tbl_med_mcc_unit_master U    ON P.mcc_code = U.id
      LEFT  JOIN dbo.tbl_med_business_unit_master BU ON BU.id = S.business_unit_id
      LEFT  JOIN dbo.tbl_med_mcc_patient_samples_status_master STAT
             ON STAT.id = S.sample_status
      WHERE S.modifieddate >= CONVERT(DATETIME, @from)
        AND S.modifieddate <  DATEADD(DAY, 1, CONVERT(DATETIME, @to))
        -- Mirrors the worksheet SP's visibility rule.
        AND S.sample_status > 1
        ${scopeClause}
        ${clientClause}
        ${buClause}
        AND (
             S.testnames   LIKE @q
          OR P.name        LIKE @q
          OR S.vailid      LIKE @q
          OR U.MCCUnitCode LIKE @q
          OR P.bill_number LIKE @q
          OR (@pidExact IS NOT NULL AND P.id = @pidExact)
        )
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
