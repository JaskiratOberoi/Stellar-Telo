'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  getPendingRegistrations,
  type PendingRegistrationsFeed,
} from '@/actions/orders.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtIST } from '@/lib/datetime';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * The "allotted but not yet registered" queue — samples that already have a
 * Sample ID but are still at LIS status 1 ("Sample Sent"), so the worksheet
 * (which filters `sample_status > 1`) cannot show them yet. Complements
 * PendingAccessionsList, which lists orders still MISSING their Sample IDs.
 */
export function PendingRegistrationsList({
  initial,
  variant = 'new',
}: {
  initial: PendingRegistrationsFeed;
  /** Drives the order type fetched and the accession back-link. */
  variant?: 'new' | 'b2b';
}) {
  const [feed, setFeed] = useState<PendingRegistrationsFeed>(initial);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const detailHref = (billId: number) =>
    variant === 'b2b' ? `/orders/new/${billId}?from=b2b` : `/orders/new/${billId}`;

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setFeed(await getPendingRegistrations(variant));
    } finally {
      setBusy(false);
    }
  }, [variant]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return feed.samples;
    return feed.samples.filter(
      (s) =>
        s.vailid.toLowerCase().includes(needle) ||
        (s.patientName ?? '').toLowerCase().includes(needle) ||
        String(s.billNumber ?? s.billId ?? '').includes(needle) ||
        (s.mccCode ?? '').toLowerCase().includes(needle),
    );
  }, [feed.samples, q]);

  const empty =
    feed.samples.length === 0
      ? 'No samples pending accessioning — every allotted SID is registered.'
      : 'No match.';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          placeholder="Filter by SID, patient, bill # or MCC…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8 max-w-sm"
          suppressHydrationWarning
        />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {feed.samples.length} pending accessioning · updated{' '}
            {fmtIST(feed.fetchedAt, 'time')} IST
          </span>
          <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Mobile (<sm): one card per sample. */}
      <div className="space-y-2 sm:hidden">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-foreground/5 bg-card p-4 text-sm text-muted-foreground">
            {empty}
          </div>
        ) : (
          rows.map((s) => (
            <div
              key={s.sampleId}
              className="rounded-lg border border-foreground/5 bg-card p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium">{s.vailid}</p>
                  <p className="mt-0.5 truncate text-sm">
                    {s.patientName ?? '—'}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    {s.billId != null && (
                      <Link
                        href={detailHref(s.billId)}
                        className="font-mono underline underline-offset-2"
                      >
                        #{s.billNumber ?? s.billId}
                      </Link>
                    )}
                    {s.mccCode && <span>· {s.mccCode}</span>}
                    <span>· {fmtIST(s.addedAt)}</span>
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                  {s.statusName ?? 'Sample Sent'}
                </span>
              </div>
              {s.testNames && (
                <p className="mt-2 border-t border-foreground/5 pt-2 text-[11px] text-muted-foreground">
                  {s.testNames}
                </p>
              )}
            </div>
          ))
        )}
      </div>

      {/* Desktop (sm+): the full table. */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">SID</TableHead>
              <TableHead className="w-40">Allotted</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead className="w-24">MCC</TableHead>
              <TableHead className="w-28">Bill #</TableHead>
              <TableHead className="w-28">Sample</TableHead>
              <TableHead className="w-36 text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => (
                <TableRow
                  key={s.sampleId}
                  className="group transition-transform hover:-translate-y-px"
                >
                  <TableCell className="font-mono text-xs font-medium">
                    {s.vailid}
                  </TableCell>
                  <TableCell>{fmtIST(s.addedAt)}</TableCell>
                  <TableCell>
                    <span className="block">{s.patientName ?? '—'}</span>
                    {s.testNames && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {s.testNames}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.mccCode ?? '—'}
                  </TableCell>
                  <TableCell>
                    {s.billId != null ? (
                      <Link
                        href={detailHref(s.billId)}
                        className="font-mono text-xs underline underline-offset-2"
                      >
                        {s.billNumber ?? s.billId}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.sampleTypeName ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-400">
                      {s.statusName ?? 'Sample Sent'}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
