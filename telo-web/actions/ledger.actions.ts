'use server';

import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import {
  summarizeTeloAccounts,
  listTeloBillsForMcc,
  listTeloReceiptsForBills,
  type AccountsRow,
  type PendingBillRow,
  type BillReceiptRow,
} from '@/db/read/ledger';

export interface AccountsTotals {
  bills: number;
  charges: number;
  discount: number;
  net: number;
  received: number;
  refund: number;
  payingBalance: number;
  creditBalance: number;
  balance: number;
}

export type PaymentModeFilter = 'all' | 'cash' | 'credit';

export interface AccountsFilters {
  mccId: number | null;
  paymentMode: PaymentModeFilter;
}

export interface AccountsSummary {
  rows: AccountsRow[];
  totals: AccountsTotals;
  scopeCount: number;
  range: { from: string; to: string };
  filters: AccountsFilters;
  fetchedAt: string;
}

export interface LedgerForMcc {
  mccId: number;
  bills: PendingBillRow[];
  receiptsByBill: Record<number, BillReceiptRow[]>;
  totalBalance: number;
  range: { from: string; to: string };
  fetchedAt: string;
}

const EMPTY_TOTALS: AccountsTotals = {
  bills: 0,
  charges: 0,
  discount: 0,
  net: 0,
  received: 0,
  refund: 0,
  payingBalance: 0,
  creditBalance: 0,
  balance: 0,
};

function sumTotals(rows: AccountsRow[]): AccountsTotals {
  const t = { ...EMPTY_TOTALS };
  for (const r of rows) {
    t.bills += r.bills;
    t.charges += r.charges;
    t.discount += r.discount;
    t.net += r.net;
    t.received += r.received;
    t.refund += r.refund;
    t.payingBalance += r.payingBalance;
    t.creditBalance += r.creditBalance;
    t.balance += r.balance;
  }
  return t;
}

/**
 * Per-MCC accounts rollup for Telo-originated bills within a date range.
 * Page server-component calls this with searchParams-derived from/to.
 */
export async function getAccountsSummary(args: {
  from: string;
  to: string;
  mccId?: number | null;
  paymentMode?: PaymentModeFilter;
}): Promise<AccountsSummary> {
  const filters: AccountsFilters = {
    mccId: args.mccId ?? null,
    paymentMode: args.paymentMode ?? 'all',
  };
  const user = await currentUser();
  if (!user || !hasCapability(user.caps, 'balance:view')) {
    return {
      rows: [],
      totals: EMPTY_TOTALS,
      scopeCount: 0,
      range: { from: args.from, to: args.to },
      filters,
      fetchedAt: new Date().toISOString(),
    };
  }
  const scope = await getMccScope(user.uid);
  const rows = await summarizeTeloAccounts(scope, args.from, args.to, {
    mccId: filters.mccId,
    paymentMode: filters.paymentMode === 'all' ? null : filters.paymentMode,
  });
  return {
    rows,
    totals: sumTotals(rows),
    scopeCount: scope.length,
    range: { from: args.from, to: args.to },
    filters,
    fetchedAt: new Date().toISOString(),
  };
}

/** Drill-down: Telo bills for one MCC within the same date window. */
export async function getLedgerForMcc(
  mccId: number,
  args: { from: string; to: string },
): Promise<LedgerForMcc> {
  const user = await currentUser();
  if (!user || !hasCapability(user.caps, 'balance:view')) {
    return {
      mccId,
      bills: [],
      receiptsByBill: {},
      totalBalance: 0,
      range: args,
      fetchedAt: new Date().toISOString(),
    };
  }
  const scope = await getMccScope(user.uid);
  const bills = await listTeloBillsForMcc(mccId, scope, args.from, args.to);
  const receiptRows = await listTeloReceiptsForBills(bills.map((b) => b.billId));
  const receiptsByBill: Record<number, BillReceiptRow[]> = {};
  for (const row of receiptRows) {
    (receiptsByBill[row.billId] ??= []).push(row);
  }
  return {
    mccId,
    bills,
    receiptsByBill,
    totalBalance: bills.reduce((a, b) => a + b.balance, 0),
    range: args,
    fetchedAt: new Date().toISOString(),
  };
}
