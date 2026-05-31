import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/*
 * NO-BACKDATE INVARIANT — see db/sp/recordReceipt.ts for the full rationale.
 * `recd_date` on the refund row is set by GETDATE() inside
 * dbo.usp_telo_record_refund (db/sql/81_usp_telo_record_refund.sql). Do NOT
 * add a date parameter to this wrapper: the daily-refund KPI on the
 * dashboard / accounts page keys off `recd_date` (see db/read/receipts.ts),
 * and shifting refund dates would corrupt period reconciliation just like
 * payment backdating would.
 */

export interface RecordRefundResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  balance: number | null;
  txnId: string | null;
}

/**
 * Calls dbo.usp_telo_record_refund — Telo-internal refund posting. Symmetric
 * to recordReceipt: writes a marker receipt row (receive_status='2'), then
 * decrements amount_paid and increments Balance.
 */
export async function recordRefund(args: {
  billId: number;
  amount: number;
  payMode?: string;
  reference?: string | null;
  userId?: number | null;
}): Promise<RecordRefundResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('billId', sql.Int, args.billId)
      .input('amount', sql.Int, args.amount)
      .input('payMode', sql.VarChar(50), args.payMode ?? 'Cash')
      .input('reference', sql.VarChar(100), args.reference ?? null)
      .input('userId', sql.Int, args.userId ?? null)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        balance: number | null;
        txn_id: string | null;
      }>('dbo.usp_telo_record_refund');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      balance: row?.balance ?? null,
      txnId: row?.txn_id?.trim() || null,
    };
  });
}
