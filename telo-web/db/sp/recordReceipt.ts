import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/*
 * ─────────────────────────────────────────────────────────────────────────
 * NO-BACKDATE INVARIANT
 * ─────────────────────────────────────────────────────────────────────────
 * `recd_date` on tbl_billing_patient_amount_receipt is set by SQL Server's
 * GETDATE() inside dbo.usp_telo_record_receipt — see the INSERT in
 * db/sql/80_usp_telo_record_receipt.sql. This wrapper deliberately does NOT
 * expose a date parameter.
 *
 * Daily collection reports (`db/read/receipts.ts`, consumed by the
 * dashboard, accounts page, and printed account statement) key off
 * `recd_date` to answer "what came in today". If a date parameter is ever
 * added here, an operator could backdate a cash receipt and shift money
 * between days' books — a financial-integrity bug.
 *
 * If a backdate is ever genuinely required (e.g. fixing a data-entry
 * mistake), route it through a separate admin-only SP with its own RBAC
 * capability and a permanent audit-log entry — do NOT extend this one.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface RecordReceiptResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  alreadyRecorded: boolean;
  balance: number | null;
  txnId: string | null;
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
        txn_id: string | null;
      }>('dbo.usp_telo_record_receipt');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      alreadyRecorded: row?.already_recorded === true,
      balance: row?.balance ?? null,
      txnId: row?.txn_id?.trim() || null,
    };
  });
}
