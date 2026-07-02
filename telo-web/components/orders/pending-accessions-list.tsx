'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { getPendingAccessions, type PendingAccessionsFeed } from '@/actions/orders.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PrintBillButton, PrintLabButton } from '@/components/orders/print-bill-button';
import { fmtIST } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { Inbox, RefreshCw, SearchX } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function PendingAccessionsList({
  initial,
  highlightBillId,
  variant = 'new',
}: {
  initial: PendingAccessionsFeed;
  /** A just-registered bill id to highlight (from ?created=). */
  highlightBillId?: number;
  /** Which worklist this is — drives the order type and the accession
   *  back-link. 'new' = New order tab, 'b2b' = B2B Orders tab. The "register"
   *  shortcut is now the global NewOrderFab (components/layout/new-order-fab). */
  variant?: 'new' | 'b2b';
}) {
  const [feed, setFeed] = useState<PendingAccessionsFeed>(initial);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const canViewBill = feed.canViewBill;
  // Accession detail is shared; `from` controls its "← Worklist" back-link.
  const detailHref = (billId: number) =>
    variant === 'b2b' ? `/orders/new/${billId}?from=b2b` : `/orders/new/${billId}`;

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setFeed(await getPendingAccessions(variant));
    } finally {
      setBusy(false);
    }
  }, [variant]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return feed.orders;
    return feed.orders.filter(
      (o) =>
        (o.patientName ?? '').toLowerCase().includes(needle) ||
        String(o.billNumber ?? o.billId).includes(needle) ||
        String(o.mccCode ?? '').includes(needle),
    );
  }, [feed.orders, q]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          placeholder="Filter by patient, bill # or MCC…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
          suppressHydrationWarning
        />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {feed.orders.length} awaiting accessioning · updated{' '}
            {fmtIST(feed.fetchedAt, 'time')} IST
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={busy}
            className="gap-1.5"
          >
            <RefreshCw
              aria-hidden
              className={cn(
                'h-3.5 w-3.5',
                busy && 'animate-spin motion-reduce:animate-none',
              )}
            />
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Mobile (<sm): one card per pending order — the 7-column table is
          unreadable on a phone. */}
      <div className="space-y-2 sm:hidden">
        {rows.length === 0 ? (
          <EmptyState allEmpty={feed.orders.length === 0} />
        ) : (
          rows.map((o) => {
            const complete = o.haveGroups >= o.requiredGroups;
            const remaining = Math.max(0, o.requiredGroups - o.haveGroups);
            const href = detailHref(o.billId);
            return (
              <div
                key={o.billId}
                className={cn(
                  'rounded-xl border border-border/70 bg-card p-3 shadow-elevation-1',
                  highlightBillId === o.billId &&
                    'animate-fade-in bg-success/10 ring-1 ring-success/40 motion-reduce:animate-none',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {o.patientName ?? '—'}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <Link
                        href={href}
                        className="font-mono underline underline-offset-2"
                      >
                        #{o.billNumber ?? o.billId}
                      </Link>
                      {o.mccCode && <span>· {o.mccCode}</span>}
                      <span>· {fmtIST(o.billDate)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
                        complete
                          ? 'bg-success/15 text-success'
                          : 'bg-warning/15 text-warning',
                      )}
                    >
                      {o.haveGroups}/{o.requiredGroups} SIDs
                    </span>
                    {canViewBill && (
                      <span className="text-sm font-semibold tabular-nums">
                        ₹{o.total}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
                  <Button
                    asChild
                    size="sm"
                    variant={complete ? 'outline' : 'default'}
                  >
                    <Link href={href}>
                      {complete
                        ? 'View SIDs'
                        : `Add SID${remaining === 1 ? '' : 's'}`}
                    </Link>
                  </Button>
                  <PrintLabButton billId={o.billId} billNumber={o.billNumber} />
                  {canViewBill && (
                    <PrintBillButton billId={o.billId} billNumber={o.billNumber} />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop (sm+): the full worklist table. */}
      <div className="hidden sm:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Bill #</TableHead>
            <TableHead className="w-40">Registered</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead className="w-20">MCC</TableHead>
            <TableHead className="w-24 text-center">SIDs</TableHead>
            {canViewBill && (
              <TableHead className="w-24 text-right">Amount</TableHead>
            )}
            <TableHead className="w-44 md:w-64 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={canViewBill ? 7 : 6} className="p-0">
                <EmptyState allEmpty={feed.orders.length === 0} borderless />
              </TableCell>
            </TableRow>
          ) : (
            rows.map((o) => {
              const complete = o.haveGroups >= o.requiredGroups;
              const remaining = Math.max(0, o.requiredGroups - o.haveGroups);
              const href = detailHref(o.billId);
              return (
                <TableRow
                  key={o.billId}
                  className={cn(
                    'group',
                    highlightBillId === o.billId &&
                      'bg-success/10 ring-1 ring-inset ring-success/40',
                  )}
                >
                  <TableCell>
                    <Link
                      href={href}
                      className="font-mono text-xs underline underline-offset-2"
                    >
                      {o.billNumber ?? o.billId}
                    </Link>
                  </TableCell>
                  <TableCell>{fmtIST(o.billDate)}</TableCell>
                  <TableCell>{o.patientName ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {o.mccCode ?? '—'}
                  </TableCell>
                  <TableCell className="text-center">
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums',
                        complete
                          ? 'bg-success/15 text-success'
                          : 'bg-warning/15 text-warning',
                      )}
                    >
                      {o.haveGroups}/{o.requiredGroups}
                    </span>
                  </TableCell>
                  {canViewBill && (
                    <TableCell className="text-right font-medium tabular-nums">
                      ₹{o.total}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <Button
                        asChild
                        size="sm"
                        variant={complete ? 'outline' : 'default'}
                      >
                        <Link
                          href={href}
                          aria-label={
                            complete
                              ? `View Sample IDs for bill ${o.billNumber ?? o.billId}`
                              : `Add ${remaining} Sample ID${remaining === 1 ? '' : 's'} for bill ${o.billNumber ?? o.billId}`
                          }
                        >
                          {complete
                            ? 'View SIDs'
                            : `Add SID${remaining === 1 ? '' : 's'}`}
                        </Link>
                      </Button>
                      <PrintLabButton billId={o.billId} billNumber={o.billNumber} />
                      {canViewBill && (
                        <PrintBillButton billId={o.billId} billNumber={o.billNumber} />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}

/**
 * Friendly empty state shared by the mobile card list and the desktop table.
 * `allEmpty` = the worklist is genuinely clear; otherwise the filter simply
 * matched nothing. `borderless` when rendered inside the table (which already
 * draws its own frame).
 */
function EmptyState({
  allEmpty,
  borderless = false,
}: {
  allEmpty: boolean;
  borderless?: boolean;
}) {
  const Icon = allEmpty ? Inbox : SearchX;
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 px-4 py-10 text-center',
        !borderless && 'rounded-xl border border-border/70 bg-card shadow-elevation-1',
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium">
        {allEmpty ? 'All caught up' : 'No matching orders'}
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {allEmpty
          ? 'No orders are awaiting Sample IDs right now — new registrations will appear here.'
          : 'Nothing matches that filter. Try a different patient name, bill # or MCC.'}
      </p>
    </div>
  );
}
