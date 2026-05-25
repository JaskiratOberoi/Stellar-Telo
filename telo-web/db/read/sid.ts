import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Does this sample ID (vailid) already exist in Noble? Read-only, parameterised.
 * Used for real-time duplicate feedback in the new-order form. The createOrder
 * SP + trigger_PreventDuplicate remain the hard uniqueness guarantee — this is
 * purely a pre-submit UX check (a race could still slip through and would be
 * rejected server-side with a clean CONFLICT).
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
