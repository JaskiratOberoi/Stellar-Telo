'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Pin, PinOff } from 'lucide-react';
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
  doctorName: string | null;
  customerName: string | null;
  paymentType: string | null;
  age: number | null;
  ageType: number | null;
  amount: number;
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

  const isPinned = (b: BalanceBill) =>
    b.balance < 0 && !unpinned.has(b.billId);

  // Pinned negative rows float to the top; everything else keeps the server's
  // date-desc order. Array.sort is stable, so equal-group rows are untouched.
  const sorted = useMemo(() => {
    return [...bills].sort((a, b) => {
      const pa = isPinned(a) ? 0 : 1;
      const pb = isPinned(b) ? 0 : 1;
      return pa - pb;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, unpinned]);

  const pinnedCount = sorted.filter(isPinned).length;

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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Bill #</TableHead>
          <TableHead className="w-28">Date</TableHead>
          <TableHead>Patient</TableHead>
          <TableHead>Ref. doctor</TableHead>
          <TableHead>Ref. customer</TableHead>
          <TableHead className="w-24">Payment</TableHead>
          <TableHead className="w-14 text-right">Age</TableHead>
          <TableHead className="w-24 text-right">Amount</TableHead>
          <TableHead className="w-24 text-right">Paid</TableHead>
          <TableHead className="w-24 text-right">Balance</TableHead>
          <TableHead className="w-28" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.length === 0 ? (
          <TableRow>
            <TableCell colSpan={11} className="text-muted-foreground">
              {mine
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
                  firstUnpinned && 'border-t-2 border-white/10',
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
                      className="font-mono text-xs underline"
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
                <TableCell className="text-sm">
                  {b.customerName ?? (
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
                <TableCell className="text-right">{inr(b.amount)}</TableCell>
                <TableCell className="text-right">{inr(b.amountPaid)}</TableCell>
                <TableCell
                  className={cn(
                    'text-right font-medium',
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
                          'inline-flex items-center justify-center rounded-md border px-2 py-1 text-xs transition-all duration-150',
                          pinned
                            ? 'border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25'
                            : 'border-white/10 text-muted-foreground hover:bg-white/5 hover:text-foreground',
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
                      className="inline-flex items-center justify-center rounded-md border border-white/10 px-2.5 py-1 text-xs text-muted-foreground transition-all duration-150 hover:bg-white/5 hover:text-foreground hover:border-white/20"
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
  );
}
