import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { cached } from '@/lib/cache';

/**
 * Per-test catalog metadata that the worksheet result rows don't carry —
 * the report test name, method (e.g. CLIA), the long Interpretation paragraph,
 * and the report-display normal-ranges text. Lives in `tbl_med_test_master`
 * keyed by `TestCode` (e.g. 'BI221' for TSH). Master data — redis-cached.
 */
export interface TestMeta {
  id: number;
  testCode: string;
  testName: string | null;
  reportTestName: string | null;
  method: string | null;
  interpretation: string | null;
  reportNormalRanges: string | null;
}

const TTL_SECONDS = 60 * 60; // master data — rarely changes

export async function getTestMeta(testCode: string): Promise<TestMeta | null> {
  const code = testCode.trim();
  if (!code) return null;

  return cached<TestMeta | null>(`telo:test-meta:${code}`, TTL_SECONDS, () =>
    withRetry(async () => {
      const pool = await getPool();
      const r = await pool
        .request()
        .input('code', sql.NVarChar(50), code)
        .query<{
          id: number;
          testName: string | null;
          reportTestName: string | null;
          method: string | null;
          interpretation: string | null;
          reportNormalRanges: string | null;
        }>(`
          SELECT TOP (1)
            id,
            Testname           AS testName,
            ReportTestname     AS reportTestName,
            Method             AS method,
            -- Interpretation is NTEXT; CAST so node-mssql returns the full string.
            CAST(Interpretation AS NVARCHAR(MAX)) AS interpretation,
            ReportNormalRanges AS reportNormalRanges
          FROM dbo.tbl_med_test_master
          WHERE TestCode = @code
          ORDER BY IsActive DESC, id DESC
        `);
      const row = r.recordset[0];
      if (!row) return null;
      return {
        id: row.id,
        testCode: code,
        testName: row.testName?.trim() || null,
        reportTestName: row.reportTestName?.trim() || null,
        method: row.method?.trim() || null,
        interpretation: row.interpretation?.trim() || null,
        reportNormalRanges: row.reportNormalRanges?.trim() || null,
      };
    }),
  );
}
