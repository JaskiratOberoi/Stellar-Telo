import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface CancelTestResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  balance: number | null;
}

/**
 * Calls dbo.usp_telo_cancel_test — cancels one test on a Telo bill: keeps the
 * original line, adds a negative "(Cancelled)" offset line, removes the
 * ordered-test row, pulls the code from a still-registered SID, and records the
 * reason in telo_test_cancellation. Refuses accessioned samples / masters /
 * split items (returns ok=false with an errorCode/message). Caller must already
 * be authorised (super admin) — see actions/billing-admin.actions.ts.
 */
export async function cancelTest(args: {
  billId: number;
  lineId: number;
  actor: number;
  reason: string;
}): Promise<CancelTestResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('billId', sql.Int, args.billId)
      .input('lineId', sql.Int, args.lineId)
      .input('userId', sql.Int, args.actor)
      .input('reason', sql.NVarChar(200), args.reason)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        balance: number | null;
      }>('dbo.usp_telo_cancel_test');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      balance: row?.balance ?? null,
    };
  });
}
