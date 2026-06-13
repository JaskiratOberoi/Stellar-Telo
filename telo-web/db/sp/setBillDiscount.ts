import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface SetBillDiscountResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  balance: number | null;
}

/**
 * Calls dbo.usp_telo_set_bill_discount — sets the absolute discount on an
 * existing Telo bill and recomputes Balance (= amount - discount - amount_paid).
 * Telo-origin bills only (the proc refuses others). Caller must already be
 * authorised (super admin) — see actions/billing-admin.actions.ts.
 */
export async function setBillDiscount(args: {
  billId: number;
  discount: number;
  actor: number;
}): Promise<SetBillDiscountResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('billId', sql.Int, args.billId)
      .input('discount', sql.Int, args.discount)
      .input('userId', sql.Int, args.actor)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        balance: number | null;
      }>('dbo.usp_telo_set_bill_discount');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      balance: row?.balance ?? null,
    };
  });
}
