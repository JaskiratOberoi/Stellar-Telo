import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Thin wrapper over dbo.usp_telo_record_mcc_online_payment — the idempotent
 * CALLBACK-side post for a CCAvenue client payment. Resolves a gateway order_id
 * back to its PENDING dbo.telo_payment_order row and, on a Success status,
 * posts the wallet credit exactly once. See db/sql/86_usp_telo_… for the full
 * contract. The route handler owns decrypting the gateway response and auditing.
 */
export interface RecordMccOnlinePaymentResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  /** A wallet credit was newly posted on this call. */
  recorded: boolean;
  /** The order had already been posted (replayed/duplicate callback). */
  alreadyRecorded: boolean;
  newBalance: number | null;
}

export async function recordMccOnlinePayment(args: {
  orderId: string;
  status: string;
  paidAmount?: number | null;
  trackingId?: string | null;
  bankRef?: string | null;
  paymentMode?: string | null;
}): Promise<RecordMccOnlinePaymentResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('orderId', sql.VarChar(30), args.orderId)
      .input('status', sql.VarChar(20), args.status)
      .input('paidAmount', sql.Int, args.paidAmount ?? null)
      .input('trackingId', sql.VarChar(40), args.trackingId ?? null)
      .input('bankRef', sql.VarChar(60), args.bankRef ?? null)
      .input('paymentMode', sql.VarChar(40), args.paymentMode ?? null)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        recorded: boolean;
        already_recorded: boolean;
        new_balance: number | null;
      }>('dbo.usp_telo_record_mcc_online_payment');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      recorded: row?.recorded === true,
      alreadyRecorded: row?.already_recorded === true,
      newBalance: row?.new_balance ?? null,
    };
  });
}
