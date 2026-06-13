import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Thin wrapper over dbo.usp_telo_record_mcc_payment — posts a MANUAL client
 * payment (deposit toward Noble) into the shared LIS franchise-wallet ledger, so
 * the balance reconciles identically in Telo and the LIS Mcc_Account screen.
 *
 * Scope + capability + throttle + audit are the CALLER's responsibility
 * (actions/billing-admin.actions.ts); this only executes the SP.
 */
export interface RecordMccPaymentResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  newBalance: number | null;
}

export async function recordMccPayment(args: {
  mcc: number;
  actor: number;
  amount: number;
  /** deposittype: 1 DD · 2 Cheque · 3 Cash · 4 NEFT/Transfer · 5 Online · 6 Other. */
  mode: number;
  /** 'YYYY-MM-DD' or null → server records "now". */
  depositDate?: string | null;
  chequeNo?: string | null;
  reason?: string | null;
}): Promise<RecordMccPaymentResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('userId', sql.Int, args.actor)
      .input('mcc', sql.Int, args.mcc)
      .input('amount', sql.Int, args.amount)
      .input('mode', sql.Int, args.mode)
      .input('depositDate', sql.VarChar(10), args.depositDate ?? null)
      .input('chequeNo', sql.NVarChar(50), args.chequeNo ?? null)
      .input('reason', sql.NVarChar(200), args.reason ?? null)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        new_balance: number | null;
      }>('dbo.usp_telo_record_mcc_payment');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      newBalance: row?.new_balance ?? null,
    };
  });
}
