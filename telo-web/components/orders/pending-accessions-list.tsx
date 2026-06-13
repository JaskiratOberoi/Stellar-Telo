'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { getPendingAccessions, type PendingAccessionsFeed } from '@/actions/orders.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PrintBillButton, PrintLabButton } from '@/components/orders/print-bill-button';
import { fmtIST } from '@/lib/datetime';
import { cn } from '@/lib/utils';
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
          className="h-8 max-w-sm"
          suppressHydrationWarning
        />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {feed.orders.length} awaiting accessioning · updated{' '}
            {fmtIST(feed.fetchedAt, 'time')} IST
          </span>
          <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

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
            <TableHead className="w-64 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={canViewBill ? 7 : 6}
                className="text-muted-foreground"
              >
                {feed.orders.length === 0
                  ? 'No orders awaiting Sample IDs.'
                  : 'No match.'}
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
                    'group transition-transform hover:-translate-y-px',
                    highlightBillId === o.billId &&
                      'bg-secondary/10 ring-1 ring-secondary/40',
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
                        'rounded-full px-2.5 py-0.5 text-xs font-medium',
                        complete
                          ? 'bg-secondary/15 text-secondary'
                          : 'bg-amber-500/15 text-amber-400',
                      )}
                    >
                      {o.haveGroups}/{o.requiredGroups}
                    </span>
                  </TableCell>
                  {canViewBill && (
                    <TableCell className="text-right font-medium">
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
  );
}
