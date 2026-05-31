import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { cached } from '@/lib/cache';

/**
 * Resolves the single age-appropriate biological reference range for a test,
 * so the report shows e.g. "0.35 - 5.50" instead of dumping every age band.
 *
 * Source: `tbl_med_test_normalranges`. Each test has clean numeric rows
 * (ReportType='Auth') keyed by age band (fage..tage), an `agetype` unit
 * (1=years, 2=months, 3=days) and a gender code. We pick the **narrowest** band
 * that contains the patient's age. We deliberately ignore gender unless it
 * actually changes the answer: if the candidate rows disagree across gender
 * codes (whose 1/2 mapping is not certain in this DB), we return null and let
 * the caller fall back to the validated free-text range — never guess a range.
 */

function ageTypeFor(unit: string | null): string {
  const u = (unit ?? '').toLowerCase();
  if (u.includes('month')) return '2';
  if (u.includes('day')) return '3';
  return '1'; // years (default)
}

const NUMERIC = /^[\d.\s–-]+$/; // digits, dot, spaces, hyphen/en-dash only

export async function getAgeSpecificRange(
  testId: number,
  age: number | null,
  ageUnit: string | null,
): Promise<string | null> {
  if (!Number.isInteger(testId) || age == null || !Number.isFinite(age)) {
    return null;
  }
  const agetype = ageTypeFor(ageUnit);

  return cached<string | null>(
    `telo:report:age-range:${testId}:${agetype}:${age}`,
    60 * 60,
    () =>
      withRetry(async () => {
        const pool = await getPool();
        const r = await pool
          .request()
          .input('id', sql.Int, testId)
          .input('at', sql.NVarChar(10), agetype)
          .input('age', sql.Int, age)
          .query<{
            fnormal: string | null;
            tnormal: string | null;
            fage: number;
            tage: number;
          }>(`
            SELECT fnormal, tnormal, fage, tage
            FROM dbo.tbl_med_test_normalranges
            WHERE testid = @id
              AND ISNULL(IsActive, 1) = 1
              AND agetype = @at
              AND fage <= @age AND tage >= @age
              AND fnormal IS NOT NULL AND tnormal IS NOT NULL
              AND fnormal NOT LIKE '%[A-Za-z]%'
              AND tnormal NOT LIKE '%[A-Za-z]%'
          `);

        const rows = r.recordset
          .map((x) => ({
            lo: (x.fnormal ?? '').trim(),
            hi: (x.tnormal ?? '').trim(),
            width: x.tage - x.fage,
          }))
          .filter((x) => NUMERIC.test(x.lo) && NUMERIC.test(x.hi));
        if (rows.length === 0) return null;

        // Narrowest band containing the age.
        const minWidth = Math.min(...rows.map((x) => x.width));
        const narrowest = rows.filter((x) => x.width === minWidth);
        const distinct = new Set(narrowest.map((x) => `${x.lo}|${x.hi}`));
        if (distinct.size !== 1) return null; // gender-dependent — don't guess

        const { lo, hi } = narrowest[0];
        return `${lo} - ${hi}`;
      }),
  );
}
