import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface RecordReceiptResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  alreadyRecorded: boolean;
  balance: number | null;
}

/**
 * Calls dbo.usp_telo_record_receipt. Idempotent on gatewayRef so Razorpay
 * webhook retries are safe to replay.
 */
export async function recordReceipt(args: {
  billId: number;
  amount: number;
  payMode?: string;
  gatewayRef?: string | null;
  userId?: number | null;
}): Promise<RecordReceiptResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('billId', sql.Int, args.billId)
      .input('amount', sql.Int, args.amount)
      .input('payMode', sql.VarChar(50), args.payMode ?? 'Online')
      .input('gatewayRef', sql.VarChar(100), args.gatewayRef ?? null)
      .input('userId', sql.Int, args.userId ?? null)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        already_recorded: boolean;
        balance: number | null;
      }>('dbo.usp_telo_record_receipt');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      alreadyRecorded: row?.already_recorded === true,
      balance: row?.balance ?? null,
    };
  });
}
