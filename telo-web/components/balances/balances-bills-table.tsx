'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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

/** Idle time before a typed query is sent. Long enough to type a bill number
 *  through without the results moving underneath you. */
const SEARCH_DEBOUNCE_MS = 600;
/** Below this, the box does not search at all — see the debounce effect. */
const MIN_QUERY_LEN = 2;

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
  q,
  matchCount,
}: {
  bills: BalanceBill[];
  unpinnedIds: number[];
  mccId: number;
  from: string;
  to: string;
  mine: boolean;
  /** The search currently APPLIED by the server (from the URL). */
  q: string;
  /** Rows matching `q` across the whole period — not just this page. */
  matchCount: number;
}) {
  const router = useRouter();
  const [unpinned, setUnpinned] = useState<Set<number>>(
    () => new Set(unpinnedIds),
  );
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [, startTransition] = useTransition();
  const [isSearchPending, startSearchTransition] = useTransition();
  // Seeded from the URL so a shared/reloaded link shows its own query.
  const [query, setQuery] = useState(q);

  const isPinned = (b: BalanceBill) =>
    b.balance < 0 && !unpinned.has(b.billId);

  // Search runs in SQL over EVERY bill in the period (see db/read/ledger.ts
  // billsWhere), not over the loaded page — a bill on page 24 has to be
  // findable from page 1. That means it travels in the URL, and always resets
  // to page 1: a match set has its own paging.
  const searchHref = useCallback(
    (next: string) => {
      const params = new URLSearchParams({ from, to });
      if (mine) params.set('mine', '1');
      if (next) params.set('q', next);
      return `/balances/${mccId}?${params.toString()}`;
    },
    [mccId, from, to, mine],
  );

  // What the URL was last asked for. Compared against the incoming `q` to tell
  // OUR OWN navigation echoing back from a genuinely external URL change.
  const appliedRef = useRef(q);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Timestamp of the last keystroke — see the focus-recovery effect. */
  const lastTypedRef = useRef(0);

  const runSearch = useCallback(
    (next: string) => {
      if (next === appliedRef.current) return;
      appliedRef.current = next;
      startSearchTransition(() => {
        router.replace(searchHref(next), { scroll: false });
      });
    },
    [router, searchHref],
  );

  // Adopt the URL only when it changed from OUTSIDE this box — Back button,
  // period switch, a link. Blindly mirroring `q` here is what ate keystrokes:
  // a navigation that landed mid-typing rewrote the input back to the value
  // that had been in flight, discarding everything typed since it left.
  useEffect(() => {
    if (q === appliedRef.current) return;
    appliedRef.current = q;
    setQuery(q);
  }, [q]);

  // Belt-and-braces for the other half of "it jumps": if a re-render ever
  // detaches the input, focus lands on <body> and the next keystroke goes
  // nowhere. Reclaim it only when it was lost to the navigation itself —
  // never when the operator deliberately clicked into something else.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || document.activeElement === el) return;
    const lostToNav =
      !document.activeElement || document.activeElement === document.body;
    if (lostToNav && Date.now() - lastTypedRef.current < 2000) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [q]);

  // Debounced, and only once there's enough to search on. A single character
  // matches most of the account and fires the heaviest query in the page for
  // no useful result, so under two characters means "no search" — which also
  // makes deleting back down to one character clear the filter.
  useEffect(() => {
    const typed = query.trim();
    const next = typed.length >= MIN_QUERY_LEN ? typed : '';
    if (next === appliedRef.current) return;
    const t = setTimeout(() => runSearch(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, runSearch]);

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
  // Two different states: text sitting in the box (show the clear button) vs a
  // search the server has actually applied (show the match count). They differ
  // while debouncing, and for a query too short to search on.
  const hasText = query.trim() !== '';
  const isFiltered = q !== '';

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
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              lastTypedRef.current = Date.now();
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                // Same floor as the debounce, otherwise the effect would
                // immediately undo a one-character search forced from here.
                const typed = query.trim();
                runSearch(typed.length >= MIN_QUERY_LEN ? typed : '');
              }
            }}
            placeholder="Search all bills in this period — bill #, name, PID, SID, mobile, amount…"
            aria-label="Search bills"
            className="h-9 w-full rounded-md border border-foreground/10 bg-input pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/60"
          />
          {hasText && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                runSearch('');
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {/* Counted in SQL over the whole period. It used to read "N of 200",
            which described the loaded page and hid every match beyond it. */}
        {(isSearchPending || isFiltered || hasText) && (
          <span className="text-xs text-muted-foreground">
            {isSearchPending
              ? 'Searching…'
              : isFiltered
                ? `${matchCount.toLocaleString('en-IN')} match${
                    matchCount === 1 ? '' : 'es'
                  } in this period`
                : 'Keep typing…'}
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
              {isSearchPending
                ? 'Searching…'
                : isFiltered
                ? `No bills match “${q}” anywhere in this period.`
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
                  firstUnpinned && 'border-t-2 border-foreground/10',
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
                <TableCell className="text-xs">
                  {b.paymentType ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {fmtPatientAge(b.age, b.ageType)}
                </TableCell>
                <TableCell className="text-right">{inr(b.amount)}</TableCell>
                <TableCell className="text-right">
                  {b.discount > 0 ? (
                    `− ${inr(b.discount)}`
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
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
                            : 'border-foreground/10 text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
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
                      className="inline-flex items-center justify-center rounded-md border border-foreground/10 px-2.5 py-1 text-xs text-muted-foreground transition-all duration-150 hover:bg-foreground/5 hover:text-foreground hover:border-foreground/20"
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
