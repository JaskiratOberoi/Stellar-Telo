import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface EditReceiptAmountResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  unchanged: boolean;
  oldAmount: number | null;
  balance: number | null;
}

/**
 * Calls dbo.usp_telo_edit_receipt_amount — corrects the amount of a single
 * already-recorded payment/refund receipt on a Telo bill. The row keeps its
 * txn number and date; only `amount` changes, the bill's amount_paid/Balance
 * shift by the delta, and one dbo.telo_receipt_edit audit row is appended
 * (who/when/from→to/why). Reason is mandatory. Caller must already be
 * authorised (super admin) — see actions/billing-admin.actions.ts.
 */
export async function editReceiptAmount(args: {
  receiptId: number;
  billId: number;
  newAmount: number;
  actor: number;
  reason: string;
}): Promise<EditReceiptAmountResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('receiptId', sql.Int, args.receiptId)
      .input('billId', sql.Int, args.billId)
      .input('newAmount', sql.Int, args.newAmount)
      .input('userId', sql.Int, args.actor)
      .input('reason', sql.NVarChar(200), args.reason)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        unchanged: boolean;
        old_amount: number | null;
        balance: number | null;
      }>('dbo.usp_telo_edit_receipt_amount');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      unchanged: row?.unchanged === true,
      oldAmount: row?.old_amount ?? null,
      balance: row?.balance ?? null,
    };
  });
}
