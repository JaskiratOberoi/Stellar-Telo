import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface VoidReceiptResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  alreadyVoided: boolean;
  balance: number | null;
}

/**
 * Calls dbo.usp_telo_void_receipt — voids a single payment/refund receipt on a
 * Telo bill (keeps the row for the trail, writes telo_receipt_void, reverses
 * its effect on amount_paid/Balance). Idempotent. Caller must already be
 * authorised (super admin) — see actions/billing-admin.actions.ts.
 */
export async function voidReceipt(args: {
  receiptId: number;
  billId: number;
  actor: number;
  reason?: string | null;
}): Promise<VoidReceiptResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('receiptId', sql.Int, args.receiptId)
      .input('billId', sql.Int, args.billId)
      .input('userId', sql.Int, args.actor)
      .input('reason', sql.NVarChar(200), args.reason ?? null)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        already_voided: boolean;
        balance: number | null;
      }>('dbo.usp_telo_void_receipt');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      alreadyVoided: row?.already_voided === true,
      balance: row?.balance ?? null,
    };
  });
}
