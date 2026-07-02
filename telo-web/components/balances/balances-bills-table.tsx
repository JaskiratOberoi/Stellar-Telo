'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Pin, PinOff, Search, X } from 'lucide-react';
import { fmtIST } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { toggleBalancePin } from '@/actions/balancePins.actions';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface BalanceBill {
  billId: number;
  billNumber: number | null;
  billDate: string | null;
  patientName: string | null;
  patientId: number | null;
  doctorName: string | null;
  customerName: string | null;
  paymentType: string | null;
  mobile: string | null;
  /** Comma-joined Sample IDs for this bill's patient (search only). */
  sids: string | null;
  age: number | null;
  ageType: number | null;
  amount: number;
  discount: number;
  amountPaid: number;
  balance: number;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

// Patient age label — ageType 1=Years (default), 2=Months, 3=Days.
function fmtPatientAge(age: number | null, ageType: number | null): string {
  if (age == null) return '—';
  const unit = ageType === 2 ? 'M' : ageType === 3 ? 'D' : 'Y';
  return `${age}${unit}`;
}

/**
 * Interactive accounts bills table.
 *
 * Negative-balance rows are highlighted light-red and, by default, pinned to the
 * top to draw attention (a negative balance means the bill is overpaid / a
 * refund is due). Each negative row carries a pin toggle; unpinning drops it
 * back into normal date order — persisted per Telo user (colleagues sharing the
 * login are unaffected). Reordering happens client-side (optimistic) so it's
 * instant and avoids a full navigation.
 */
export function BalancesBillsTable({
  bills,
  unpinnedIds,
  mccId,
  from,
  to,
  mine,
}: {
  bills: BalanceBill[];
  unpinnedIds: number[];
  mccId: number;
  from: string;
  to: string;
  mine: boolean;
}) {
  const [unpinned, setUnpinned] = useState<Set<number>>(
    () => new Set(unpinnedIds),
  );
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState('');

  const isPinned = (b: BalanceBill) =>
    b.balance < 0 && !unpinned.has(b.billId);

  // Free-text search across every field on the bill — bill #, patient name,
  // PID, SIDs, ref doctor, MRD/visit, payment mode, mobile, and the money
  // columns (amount/discount/paid/balance) plus the date. Pure client-side
  // filter over the already-loaded rows, so it's instant. Multi-word queries
  // are AND-matched (e.g. "raja 120" needs both tokens present).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bills;
    const terms = q.split(/\s+/);
    return bills.filter((b) => {
      const hay = [
        b.billNumber,
        b.billId,
        b.patientName,
        b.patientId,
        b.sids,
        b.doctorName,
        b.customerName,
        b.paymentType,
        b.mobile,
        b.amount,
        b.discount,
        b.amountPaid,
        b.balance,
        b.age,
        b.billDate ? fmtIST(b.billDate, 'date') : null,
        b.billDate, // raw ISO so YYYY-MM-DD queries also match
      ]
        .filter((v) => v != null && v !== '')
        .join(' ')
        .toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [bills, query]);

  // Pinned negative rows float to the top; everything else keeps the server's
  // date-desc order. Array.sort is stable, so equal-group rows are untouched.
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const pa = isPinned(a) ? 0 : 1;
      const pb = isPinned(b) ? 0 : 1;
      return pa - pb;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, unpinned]);

  const pinnedCount = sorted.filter(isPinned).length;
  const isSearching = query.trim() !== '';

  function setPin(billId: number, nextPinned: boolean) {
    // Optimistic: update local set immediately, then persist.
    setUnpinned((prev) => {
      const next = new Set(prev);
      if (nextPinned) next.delete(billId);
      else next.add(billId);
      return next;
    });
    setPendingIds((prev) => new Set(prev).add(billId));
    startTransition(async () => {
      const res = await toggleBalancePin(billId, nextPinned).catch(() => ({
        ok: false,
      }));
      if (!res.ok) {
        // Revert on failure.
        setUnpinned((prev) => {
          const next = new Set(prev);
          if (nextPinned) next.add(billId);
          else next.delete(billId);
          return next;
        });
      }
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(billId);
        return next;
      });
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bill #, name, PID, SID, mobile, amount, discount…"
            aria-label="Search bills"
            className="h-10 w-full rounded-lg border border-border bg-input pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/60"
          />
          {isSearching && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {isSearching && (
          <span className="text-xs text-muted-foreground">
            {sorted.length} match{sorted.length === 1 ? '' : 'es'} of {bills.length}
          </span>
        )}
      </div>
      <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Bill #</TableHead>
          <TableHead className="w-28">Date</TableHead>
          <TableHead>Patient</TableHead>
          <TableHead>Ref. doctor</TableHead>
          <TableHead className="w-24">Payment</TableHead>
          <TableHead className="w-14 text-right">Age</TableHead>
          <TableHead className="w-24 text-right">Amount</TableHead>
          <TableHead className="w-24 text-right">Discount</TableHead>
          <TableHead className="w-24 text-right">Paid</TableHead>
          <TableHead className="w-24 text-right">Balance</TableHead>
          <TableHead className="w-28" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.length === 0 ? (
          <TableRow>
            <TableCell colSpan={11} className="text-muted-foreground">
              {isSearching
                ? `No bills match “${query.trim()}”.`
                : mine
                  ? 'No bills registered by you for this client in this date range.'
                  : 'No Telo bills for this client in this date range.'}
            </TableCell>
          </TableRow>
        ) : (
          sorted.map((b, idx) => {
            const negative = b.balance < 0;
            const pinned = isPinned(b);
            const pending = pendingIds.has(b.billId);
            // Visual divider between the pinned block and the rest.
            const firstUnpinned =
              pinnedCount > 0 && idx === pinnedCount && !pinned;
            const detailHref = `/orders/${b.billId}?back=${encodeURIComponent(
              `/balances/${mccId}?from=${from}&to=${to}`,
            )}`;
            return (
              <TableRow
                key={b.billId}
                className={cn(
                  negative && 'bg-destructive/10 hover:bg-destructive/20',
                  firstUnpinned && 'border-t-2 border-border',
                )}
              >
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    {pinned && (
                      <Pin
                        className="h-3 w-3 shrink-0 text-destructive"
                        aria-label="Pinned"
                      />
                    )}
                    <Link
                      href={detailHref}
                      className="rounded font-mono text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      {b.billNumber ?? b.billId}
                    </Link>
                  </span>
                </TableCell>
                <TableCell>{fmtIST(b.billDate, 'date')}</TableCell>
                <TableCell>{b.patientName ?? '—'}</TableCell>
                <TableCell className="text-sm">
                  {b.doctorName ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {b.paymentType ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {fmtPatientAge(b.age, b.ageType)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{inr(b.amount)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {b.discount > 0 ? (
                    `− ${inr(b.discount)}`
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{inr(b.amountPaid)}</TableCell>
                <TableCell
                  className={cn(
                    'text-right font-semibold tabular-nums',
                    negative && 'text-destructive',
                  )}
                >
                  {inr(b.balance)}
                </TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center justify-end gap-1.5">
                    {negative && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setPin(b.billId, !pinned)}
                        title={pinned ? 'Unpin from top' : 'Pin to top'}
                        aria-pressed={pinned}
                        className={cn(
                          'inline-flex items-center justify-center rounded-md border px-2 py-1 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                          pinned
                            ? 'border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25'
                            : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                          pending && 'cursor-wait opacity-60',
                        )}
                      >
                        {pinned ? (
                          <PinOff className="h-3.5 w-3.5" />
                        ) : (
                          <Pin className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                    <Link
                      href={detailHref}
                      className="inline-flex items-center justify-center rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      View →
                    </Link>
                  </span>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
    </div>
  );
}
