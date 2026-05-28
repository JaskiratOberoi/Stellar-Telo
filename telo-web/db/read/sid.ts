import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Does this sample ID (vailid) already exist in Noble? Read-only, parameterised.
 * Used for real-time duplicate feedback in the new-order form. The createOrder
 * SP + trigger_PreventDuplicate remain the hard uniqueness guarantee — this is
 * purely a pre-submit UX check (a race could still slip through and would be
 * rejected server-side with a clean CONFLICT).
 *
 * Prefer `sidExistsInScope` for caller-facing flows: an unscoped check lets
 * any signed-in user enumerate sample IDs from centres they don't own.
 */
export async function sidExists(vailid: string): Promise<boolean> {
  const v = vailid.trim();
  if (!v) return false;
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('v', sql.NVarChar(50), v)
      .query<{ x: number }>(
        'SELECT TOP 1 1 AS x FROM dbo.tbl_med_mcc_patient_samples WHERE vailid = @v',
      );
    return r.recordset.length > 0;
  });
}

/**
 * Scoped variant — returns true only when the SID belongs to a patient in one
 * of the caller's MCCs. The hard uniqueness invariant is still global (the
 * trigger rejects any duplicate at write time), but this check answers the
 * question the form actually asks: "is this SID one I would conflict with?"
 * without leaking out-of-scope SID existence.
 *
 * Empty scope → false (no centres, no possible conflict the caller can see).
 * Unrestricted roles (>1000 centres) skip the IN-filter — same convention as
 * orders.ts/ledger.ts. Joins via patient → mcc_code on the patient_master
 * row, so the check is one indexed lookup + one join (no full scan).
 */
export async function sidExistsInScope(
  vailid: string,
  scope: number[],
): Promise<boolean> {
  const v = vailid.trim();
  if (!v) return false;
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return false;
  const unrestricted = ids.length > 1000;
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('v', sql.NVarChar(50), v);
    const scopeClause = unrestricted
      ? ''
      : `AND p.mcc_code IN (${ids
          .map((c, i) => {
            req.input(`s${i}`, sql.Int, c);
            return `@s${i}`;
          })
          .join(',')})`;
    const r = await req.query<{ x: number }>(`
      SELECT TOP 1 1 AS x
      FROM dbo.tbl_med_mcc_patient_samples s
      JOIN dbo.tbl_med_mcc_patient_master p ON p.id = s.patient_id
      WHERE s.vailid = @v
      ${scopeClause}
    `);
    return r.recordset.length > 0;
  });
}
