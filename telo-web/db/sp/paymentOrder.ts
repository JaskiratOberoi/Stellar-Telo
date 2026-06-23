import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Writes/reads for the Telo-owned dbo.telo_payment_order sidecar — the trust
 * anchor for the CCAvenue client-payment flow (see db/sql/29_table_…). The
 * gateway callback NEVER decides the mcc/amount/user; it can only resolve an
 * order_id back to the row we wrote here at initiate time.
 */

export interface PaymentOrderRow {
  orderId: string;
  mcc: number;
  userId: number;
  amount: number;
  status: string;
  posted: boolean;
}

/** Insert a PENDING order. Called from /api/ccavenue/initiate before redirect. */
export async function createPaymentOrder(args: {
  orderId: string;
  mcc: number;
  userId: number;
  amount: number;
}): Promise<void> {
  return withRetry(async () => {
    const pool = await getPool();
    await pool
      .request()
      .input('orderId', sql.VarChar(30), args.orderId)
      .input('mcc', sql.Int, args.mcc)
      .input('userId', sql.Int, args.userId)
      .input('amount', sql.Int, args.amount)
      .query(`
        INSERT INTO dbo.telo_payment_order (order_id, mcc, user_id, amount, status)
        VALUES (@orderId, @mcc, @userId, @amount, 'PENDING')
      `);
  });
}

/** Look up an order by id (for the return page / diagnostics). */
export async function getPaymentOrder(
  orderId: string,
): Promise<PaymentOrderRow | null> {
  const id = (orderId ?? '').trim();
  if (!id) return null;
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('orderId', sql.VarChar(30), id)
      .query<{
        order_id: string;
        mcc: number;
        user_id: number;
        amount: number;
        status: string;
        posted: boolean;
      }>(`
        SELECT order_id, mcc, user_id, amount, status, posted
        FROM dbo.telo_payment_order
        WHERE order_id = @orderId
      `);
    const x = r.recordset[0];
    if (!x) return null;
    return {
      orderId: x.order_id,
      mcc: x.mcc,
      userId: x.user_id,
      amount: x.amount,
      status: x.status,
      posted: x.posted === true,
    };
  });
}
