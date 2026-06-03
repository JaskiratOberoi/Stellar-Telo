import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Receipt-date-keyed aggregates over `tbl_billing_patient_amount_receipt`,
 * joined to `tbl_billing_patient_detail` to apply Telo-origin and MCC scope
 * filters.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * INVARIANT — DO NOT BACKDATE PAYMENTS
 * ─────────────────────────────────────────────────────────────────────────
 * Every row in `tbl_billing_patient_amount_receipt` has its `recd_date` set
 * by `dbo.usp_telo_record_receipt` (and the refund SP) using SQL Server's
 * `GETDATE()`. The TS wrappers (`db/sp/recordReceipt.ts`,
 * `db/sp/recordRefund.ts`) accept no date parameter, and the payment action
 * (`actions/payment.actions.ts`) does not collect a date from the operator.
 *
 * The reports below trust `recd_date` to mean "when the money actually
 * changed hands" — payments recorded today against any bill (old or new)
 * roll up into TODAY's totals. If a future change adds a date parameter to
 * the receipt SP or its wrappers, every daily-collection report becomes
 * forgeable. Don't.
 *
 * `receive_status` semantics (set by the SPs): '1' = payment, '2' = refund.
 */

export interface ReceiptTotals {
  /** SUM(amount) over payments (receive_status='1') in [from, to+1d). */
  collected: number;
  /** ... and pay_mode = 'Cash'. */
  cashCollected: number;
  /** ... and pay_mode <> 'Cash'. */
  otherCollected: number;
  /** SUM(amount) over refunds (receive_status='2') in same window. */
  refunded: number;
  /** Count of payment rows. */
  receiptCount: number;
  cashCount: number;
  otherCount: number;
}

const EMPTY_TOTALS: ReceiptTotals = {
  collected: 0,
  cashCollected: 0,
  otherCollected: 0,
  refunded: 0,
  receiptCount: 0,
  cashCount: 0,
  otherCount: 0,
};

function scopeParams(req: sql.Request, scope: number[]): string {
  return scope
    .map((c, i) => {
      req.input(`s${i}`, sql.Int, c);
      return `@s${i}`;
    })
    .join(',');
}

interface ReceiptsOpts {
  /** When true, also returns per-MCC breakdown via `byMcc` map on the result. */
  byMcc?: boolean;
  /** Restrict to one MCC (must be in scope). Null = all in-scope MCCs. */
  mccId?: number | null;
  /**
   * Restrict to receipts on bills registered by one Telo user — matched on the
   * bill's `addedby='telo:<id>'` origin marker. Powers the Accounts "My
   * Accounts Summary" filter so collections line up with the same operator's
   * bills. Null = all Telo bills in scope.
   */
  registeredByUserId?: number | null;
}

export interface ReceiptTotalsWithBreakdown extends ReceiptTotals {
  byMcc?: Map<number, ReceiptTotals>;
}

/**
 * Receipt-date-keyed aggregates for a date window, optionally broken down
 * per MCC. The window is inclusive of full local days (matches `ledger.ts`):
 * `recd_date >= @from AND recd_date < @to + 1 day`.
 *
 * Mirrors the scope/unrestricted IN-list pattern used by `stats.ts` and
 * `ledger.ts`: any scope with >1000 ids skips the IN filter to avoid the
 * 2100-param ceiling.
 */
export async function getReceiptsInPeriod(
  scope: number[],
  fromIso: string,
  toIso: string,
  opts: ReceiptsOpts = {},
): Promise<ReceiptTotalsWithBreakdown> {
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) {
    return opts.byMcc
      ? { ...EMPTY_TOTALS, byMcc: new Map() }
      : { ...EMPTY_TOTALS };
  }
  const unrestricted = ids.length > 1000;

  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('from', sql.DateTime, new Date(fromIso));
    req.input('to', sql.DateTime, new Date(toIso));

    let scopeClause = unrestricted
      ? ''
      : `AND b.mcc_code IN (${scopeParams(req, ids)})`;
    if (
      opts.mccId != null &&
      Number.isInteger(opts.mccId) &&
      (unrestricted || ids.includes(opts.mccId))
    ) {
      req.input('mccOne', sql.Int, opts.mccId);
      scopeClause = 'AND b.mcc_code = @mccOne';
    }
    // Tighten the existing `b.addedby LIKE 'telo:%'` to one exact registrar.
    let mineClause = '';
    if (
      opts.registeredByUserId != null &&
      Number.isInteger(opts.registeredByUserId)
    ) {
      req.input('addedBy', sql.NVarChar(64), `telo:${opts.registeredByUserId}`);
      mineClause = 'AND b.addedby = @addedBy';
    }

    // Cash vs Others split — Telo's pay_mode column carries the same string
    // the operator picked in the UI ('Cash' / 'UPI' / 'Card' / 'Cheque' /
    // 'Online' / 'Credit'). Cash is everything matching 'Cash' exactly;
    // everything else is "Others" (UPI/Card/...). Refunds are excluded from
    // Cash/Other totals — they get their own column.
    const selectMcc = opts.byMcc ? 'b.mcc_code AS mccId,' : '';
    const groupBy = opts.byMcc ? 'GROUP BY b.mcc_code' : '';

    const r = await req.query<{
      mccId?: number;
      collected: number | null;
      cashCollected: number | null;
      otherCollected: number | null;
      refunded: number | null;
      receiptCount: number | null;
      cashCount: number | null;
      otherCount: number | null;
    }>(`
      SELECT
        ${selectMcc}
        SUM(CASE WHEN r.receive_status = '1' THEN r.amount ELSE 0 END) AS collected,
        SUM(CASE WHEN r.receive_status = '1' AND r.pay_mode = 'Cash' THEN r.amount ELSE 0 END) AS cashCollected,
        SUM(CASE WHEN r.receive_status = '1' AND (r.pay_mode IS NULL OR r.pay_mode <> 'Cash') THEN r.amount ELSE 0 END) AS otherCollected,
        SUM(CASE WHEN r.receive_status = '2' THEN r.amount ELSE 0 END) AS refunded,
        SUM(CASE WHEN r.receive_status = '1' THEN 1 ELSE 0 END) AS receiptCount,
        SUM(CASE WHEN r.receive_status = '1' AND r.pay_mode = 'Cash' THEN 1 ELSE 0 END) AS cashCount,
        SUM(CASE WHEN r.receive_status = '1' AND (r.pay_mode IS NULL OR r.pay_mode <> 'Cash') THEN 1 ELSE 0 END) AS otherCount
      FROM dbo.tbl_billing_patient_amount_receipt r
      JOIN dbo.tbl_billing_patient_detail b ON b.id = r.bill_id
      WHERE b.addedby LIKE 'telo:%'
        AND r.recd_date >= @from
        AND r.recd_date <  DATEADD(day, 1, @to)
        ${scopeClause}
        ${mineClause}
      ${groupBy}
    `);

    if (opts.byMcc) {
      const byMcc = new Map<number, ReceiptTotals>();
      let totalCollected = 0;
      let totalCash = 0;
      let totalOther = 0;
      let totalRefund = 0;
      let totalCount = 0;
      let totalCashCount = 0;
      let totalOtherCount = 0;
      for (const x of r.recordset) {
        const mccId = Number(x.mccId);
        const row: ReceiptTotals = {
          collected: Number(x.collected ?? 0),
          cashCollected: Number(x.cashCollected ?? 0),
          otherCollected: Number(x.otherCollected ?? 0),
          refunded: Number(x.refunded ?? 0),
          receiptCount: Number(x.receiptCount ?? 0),
          cashCount: Number(x.cashCount ?? 0),
          otherCount: Number(x.otherCount ?? 0),
        };
        byMcc.set(mccId, row);
        totalCollected += row.collected;
        totalCash += row.cashCollected;
        totalOther += row.otherCollected;
        totalRefund += row.refunded;
        totalCount += row.receiptCount;
        totalCashCount += row.cashCount;
        totalOtherCount += row.otherCount;
      }
      return {
        collected: totalCollected,
        cashCollected: totalCash,
        otherCollected: totalOther,
        refunded: totalRefund,
        receiptCount: totalCount,
        cashCount: totalCashCount,
        otherCount: totalOtherCount,
        byMcc,
      };
    }

    const x = r.recordset[0];
    if (!x) return { ...EMPTY_TOTALS };
    return {
      collected: Number(x.collected ?? 0),
      cashCollected: Number(x.cashCollected ?? 0),
      otherCollected: Number(x.otherCollected ?? 0),
      refunded: Number(x.refunded ?? 0),
      receiptCount: Number(x.receiptCount ?? 0),
      cashCount: Number(x.cashCount ?? 0),
      otherCount: Number(x.otherCount ?? 0),
    };
  });
}
