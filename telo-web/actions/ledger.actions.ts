'use server';

import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import {
  summarizeTeloAccounts,
  listTeloBillsForMcc,
  getTeloBillTotalsForMcc,
  type BillTotals,
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
  /** The requested page of bills — NOT the whole period. Totals below cover
   *  every matching bill; never re-derive them from this array. */
  bills: PendingBillRow[];
  receiptsByBill: Record<number, BillReceiptRow[]>;
  /** Period balance over EVERY matching bill, summed in SQL. */
  totalBalance: number;
  /** Full period aggregates (count + money), independent of the page. */
  totals: BillTotals;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Active free-text filter, applied in SQL across the whole period. */
  q: string;
  range: { from: string; to: string };
  fetchedAt: string;
}

/** Bills per page on the account summary. NOT exported: a 'use server' module
 *  may only export async functions, and the page reads the size off the
 *  returned `pageSize` anyway. */
const BILLS_PAGE_SIZE = 200;

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
  args: { from: string; to: string; mine?: boolean; q?: string; page?: number },
): Promise<LedgerForMcc> {
  const range = { from: args.from, to: args.to };
  const q = (args.q ?? '').trim();
  const pageSize = BILLS_PAGE_SIZE;
  const user = await currentUser();
  if (!user || !hasCapability(user.caps, 'balance:view')) {
    return {
      mccId,
      bills: [],
      receiptsByBill: {},
      totalBalance: 0,
      totals: { count: 0, balance: 0, amount: 0, amountPaid: 0, discount: 0, pendingCount: 0 },
      page: 1,
      pageSize,
      totalPages: 1,
      q,
      range,
      fetchedAt: new Date().toISOString(),
    };
  }
  const scope = await getMccScope(user.uid);
  const opts = { registeredByUserId: args.mine ? user.uid : null, q };

  // Totals first: they decide how many pages exist, so a stale `page` (e.g. a
  // bookmarked ?page=9 after the range narrowed) can be clamped instead of
  // returning an empty table.
  const totals = await getTeloBillTotalsForMcc(
    mccId,
    scope,
    args.from,
    args.to,
    opts,
  );
  const totalPages = Math.max(1, Math.ceil(totals.count / pageSize));
  const page = Math.min(Math.max(1, Math.floor(args.page ?? 1)), totalPages);

  const bills = await listTeloBillsForMcc(mccId, scope, args.from, args.to, {
    ...opts,
    page,
    pageSize,
  });
  // Receipts only for the rows actually shown — this used to fetch them for
  // every bill in the period.
  const receiptRows = await listTeloReceiptsForBills(bills.map((b) => b.billId));
  const receiptsByBill: Record<number, BillReceiptRow[]> = {};
  for (const row of receiptRows) {
    (receiptsByBill[row.billId] ??= []).push(row);
  }
  return {
    mccId,
    bills,
    receiptsByBill,
    // From SQL over the whole period — not `bills.reduce(...)`, which would
    // now only sum the visible page.
    totalBalance: totals.balance,
    totals,
    page,
    pageSize,
    totalPages,
    q,
    range,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * EVERY matching bill (no paging) plus its receipts — for the Excel export.
 *
 * The page renders one page at a time, so the export must not hand back
 * `data.bills`: that would silently ship only the visible rows in a workbook
 * used for mass corrections. This deliberately re-runs the same filters
 * unpaged.
 */
export async function getBillsForExport(
  mccId: number,
  args: { from: string; to: string; mine?: boolean; q?: string },
): Promise<{
  bills: PendingBillRow[];
  receiptsByBill: Record<number, BillReceiptRow[]>;
}> {
  const user = await currentUser();
  if (!user || !hasCapability(user.caps, 'balance:view')) {
    return { bills: [], receiptsByBill: {} };
  }
  const scope = await getMccScope(user.uid);
  const bills = await listTeloBillsForMcc(mccId, scope, args.from, args.to, {
    registeredByUserId: args.mine ? user.uid : null,
    q: (args.q ?? '').trim(),
  });
  const receiptRows = await listTeloReceiptsForBills(bills.map((b) => b.billId));
  const receiptsByBill: Record<number, BillReceiptRow[]> = {};
  for (const row of receiptRows) {
    (receiptsByBill[row.billId] ??= []).push(row);
  }
  return { bills, receiptsByBill };
}
