import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface PatientHit {
  pid: number;
  name: string | null;
  age: number | null;
  gender: number | null;
  mobile: string | null;
  mccCode: number | null;
  mrnId: string | null;
  registeredAt: string | null;
}

/**
 * Patient search by name / mobile / pid, restricted to the caller's MCC
 * scope. Listec doesn't expose patient data, so this uses Telo's pool with a
 * parameterised SELECT + a TVP-free IN list bounded by the scope array.
 *
 * `mccScope` MUST be the resolved scope from auth/scope.ts — never trusted
 * from the client. An empty scope yields zero rows (fail closed).
 */
export async function searchPatients(
  term: string,
  mccScope: number[],
  limit = 25,
): Promise<PatientHit[]> {
  const scope = mccScope.filter((n) => Number.isInteger(n));
  if (scope.length === 0) return [];

  const t = term.trim();
  if (!t) return [];

  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('term', sql.NVarChar(200), `%${t}%`);
    req.input('termExact', sql.NVarChar(200), t);
    req.input('lim', sql.Int, Math.min(Math.max(limit, 1), 100));

    // Bind the scope as individual parameters (bounded, no string concat).
    // An unrestricted role resolves to EVERY centre — binding one parameter per
    // id would exceed SQL Server's 2100-parameter ceiling, and at that breadth
    // the IN filter is a no-op. Same guard as db/read/orders.ts.
    const unrestricted = scope.length > 1000;
    const params = unrestricted
      ? []
      : scope.map((code, i) => {
          req.input(`m${i}`, sql.Int, code);
          return `@m${i}`;
        });

    const r = await req.query<{
      pid: number;
      name: string | null;
      age: number | null;
      gender: number | null;
      mobile: string | null;
      mccCode: number | null;
      mrnId: string | null;
      registeredAt: Date | null;
    }>(`
      SELECT TOP (@lim)
        p.id AS pid, p.name, p.age, p.gender,
        p.mobile_number AS mobile, p.mcc_code AS mccCode,
        p.MRNID AS mrnId, p.addeddate AS registeredAt
      FROM dbo.tbl_med_mcc_patient_master p
      WHERE ${unrestricted ? '1 = 1' : `p.mcc_code IN (${params.join(',')})`}
        AND (
          p.name LIKE @term
          OR p.mobile_number LIKE @term
          OR (TRY_CONVERT(INT, @termExact) IS NOT NULL AND p.id = TRY_CONVERT(INT, @termExact))
        )
      ORDER BY p.id DESC
    `);

    return r.recordset.map((x) => ({
      pid: x.pid,
      name: x.name,
      age: x.age,
      gender: x.gender,
      mobile: x.mobile,
      mccCode: x.mccCode,
      mrnId: x.mrnId,
      registeredAt: x.registeredAt ? x.registeredAt.toISOString() : null,
    }));
  });
}
