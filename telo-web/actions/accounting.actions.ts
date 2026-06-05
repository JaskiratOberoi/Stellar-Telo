'use server';

import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { addDaysIST } from '@/lib/datetime';
import {
  dailyBillSeries,
  dailyCollectionSeries,
  paymentModeBreakdown,
  cashCreditSplit,
  topDoctors,
  topCustomers,
  registrarBreakdown,
  outstandingAging,
  type NameAmountRow,
  type PaymentModeRow,
  type CashCreditSplit,
  type RegistrarRow,
  type AgingBucket,
} from '@/db/read/accounting';

/** One merged calendar-day row: billed (bill_date) + collected (recd_date). */
export interface AccountingDay {
  day: string; // 'YYYY-MM-DD'
  bills: number;
  charges: number;
  discount: number;
  net: number;
  collected: number;
  refunded: number;
  balance: number;
}

export interface AccountingTotals {
  bills: number;
  charges: number;
  discount: number;
  net: number;
  collected: number;
  cashCollected: number;
  otherCollected: number;
  refunded: number;
  balance: number;
  avgBill: number;
  /** collected / net, as a 0–100 percentage (0 when net is 0). */
  collectionRate: number;
}

export interface ClientAccountingDashboard {
  ok: boolean;
  mccId: number;
  range: { from: string; to: string };
  daily: AccountingDay[];
  paymentModes: PaymentModeRow[];
  cashCredit: CashCreditSplit;
  topDoctors: NameAmountRow[];
  topCustomers: NameAmountRow[];
  registrars: RegistrarRow[];
  aging: AgingBucket[];
  totals: AccountingTotals;
  fetchedAt: string;
}

const EMPTY_CASH_CREDIT: CashCreditSplit = {
  cashBills: 0,
  cashCharges: 0,
  cashBalance: 0,
  creditBills: 0,
  creditCharges: 0,
  creditBalance: 0,
};

function emptyDashboard(
  mccId: number,
  from: string,
  to: string,
): ClientAccountingDashboard {
  return {
    ok: false,
    mccId,
    range: { from, to },
    daily: [],
    paymentModes: [],
    cashCredit: EMPTY_CASH_CREDIT,
    topDoctors: [],
    topCustomers: [],
    registrars: [],
    aging: [],
    totals: {
      bills: 0,
      charges: 0,
      discount: 0,
      net: 0,
      collected: 0,
      cashCollected: 0,
      otherCollected: 0,
      refunded: 0,
      balance: 0,
      avgBill: 0,
      collectionRate: 0,
    },
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Full accounting dashboard payload for ONE client (MCC) over a date window.
 * Gated to `balance:view`; the MCC must be in the caller's scope. Mirrors the
 * guard in actions/ledger.actions.ts → getLedgerForMcc.
 */
export async function getClientAccountingDashboard(
  mccId: number,
  args: { from: string; to: string },
): Promise<ClientAccountingDashboard> {
  const { from, to } = args;
  const user = await currentUser();
  if (!user || !hasCapability(user.caps, 'balance:view')) {
    return emptyDashboard(mccId, from, to);
  }
  const scope = await getMccScope(user.uid);
  // Unrestricted (>1000) skips the membership check, matching the ledger reads.
  if (scope.length > 0 && scope.length <= 1000 && !scope.includes(mccId)) {
    return emptyDashboard(mccId, from, to);
  }

  const [
    billSeries,
    collectionSeries,
    paymentModes,
    cashCredit,
    docs,
    customers,
    registrars,
    aging,
  ] = await Promise.all([
    dailyBillSeries(mccId, from, to),
    dailyCollectionSeries(mccId, from, to),
    paymentModeBreakdown(mccId, from, to),
    cashCreditSplit(mccId, from, to),
    topDoctors(mccId, from, to),
    topCustomers(mccId, from, to),
    registrarBreakdown(mccId, from, to),
    outstandingAging(mccId),
  ]);

  // Merge the two day-keyed series and fill gaps across [from, to].
  const billByDay = new Map(billSeries.map((b) => [b.day, b]));
  const collByDay = new Map(collectionSeries.map((c) => [c.day, c]));
  const daily: AccountingDay[] = [];
  // Bounded loop guard (≈ up to ~5 years) in case of a malformed range.
  for (let day = from, i = 0; i <= 1850; day = addDaysIST(day, 1), i++) {
    const b = billByDay.get(day);
    const c = collByDay.get(day);
    daily.push({
      day,
      bills: b?.bills ?? 0,
      charges: b?.charges ?? 0,
      discount: b?.discount ?? 0,
      net: b?.net ?? 0,
      collected: c?.collected ?? 0,
      refunded: c?.refunded ?? 0,
      balance: b?.balance ?? 0,
    });
    if (day === to) break;
  }

  // Totals derived from the series so the cards reconcile with the table.
  const charges = billSeries.reduce((s, b) => s + b.charges, 0);
  const discount = billSeries.reduce((s, b) => s + b.discount, 0);
  const bills = billSeries.reduce((s, b) => s + b.bills, 0);
  const balance = billSeries.reduce((s, b) => s + b.balance, 0);
  const net = charges - discount;
  const collected = collectionSeries.reduce((s, c) => s + c.collected, 0);
  const cashCollected = collectionSeries.reduce((s, c) => s + c.cashCollected, 0);
  const otherCollected = collectionSeries.reduce((s, c) => s + c.otherCollected, 0);
  const refunded = collectionSeries.reduce((s, c) => s + c.refunded, 0);

  return {
    ok: true,
    mccId,
    range: { from, to },
    daily,
    paymentModes,
    cashCredit,
    topDoctors: docs,
    topCustomers: customers,
    registrars,
    aging,
    totals: {
      bills,
      charges,
      discount,
      net,
      collected,
      cashCollected,
      otherCollected,
      refunded,
      balance,
      avgBill: bills > 0 ? Math.round(charges / bills) : 0,
      collectionRate: net > 0 ? Math.round((collected / net) * 100) : 0,
    },
    fetchedAt: new Date().toISOString(),
  };
}
