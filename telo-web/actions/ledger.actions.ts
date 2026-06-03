'use server';

import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import {
  summarizeTeloAccounts,
  listTeloBillsForMcc,
  listTeloReceiptsForBills,
  searchTeloBills,
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

export interface AccountsSearchResult {
  bills: PendingBillRow[];
  range: { from: string; to: string };
  fetchedAt: string;
}

/**
 * Free-text Accounts search across the caller's scope + active filters. Returns
 * matching Telo bills (patient / bill # / doctor / customer), capped at 200.
 */
export async function searchAccountsBills(args: {
  from: string;
  to: string;
  q: string;
  mccId?: number | null;
  paymentMode?: PaymentModeFilter;
}): Promise<AccountsSearchResult> {
  const range = { from: args.from, to: args.to };
  const user = await currentUser();
  if (!user || !hasCapability(user.caps, 'balance:view')) {
    return { bills: [], range, fetchedAt: new Date().toISOString() };
  }
  const scope = await getMccScope(user.uid);
  const bills = await searchTeloBills(scope, args.from, args.to, args.q ?? '', {
    mccId: args.mccId ?? null,
    paymentMode:
      args.paymentMode && args.paymentMode !== 'all' ? args.paymentMode : null,
  });
  return { bills, range, fetchedAt: new Date().toISOString() };
}

/**
 * Drill-down: Telo bills for one MCC within the same date window. When
 * `args.mine` is set, restricts to bills registered by the caller's own Telo
 * user id (the "My Accounts Summary" filter) so operators sharing a client
 * code see only their own registrations.
 */
export async function getLedgerForMcc(
  mccId: number,
  args: { from: string; to: string; mine?: boolean },
): Promise<LedgerForMcc> {
  const range = { from: args.from, to: args.to };
  const user = await currentUser();
  if (!user || !hasCapability(user.caps, 'balance:view')) {
    return {
      mccId,
      bills: [],
      receiptsByBill: {},
      totalBalance: 0,
      range,
      fetchedAt: new Date().toISOString(),
    };
  }
  const scope = await getMccScope(user.uid);
  const bills = await listTeloBillsForMcc(
    mccId,
    scope,
    args.from,
    args.to,
    args.mine ? user.uid : null,
  );
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
    range,
    fetchedAt: new Date().toISOString(),
  };
}
