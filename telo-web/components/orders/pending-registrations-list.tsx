'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  getPendingRegistrations,
  type PendingRegistrationsFeed,
} from '@/actions/orders.actions';
import { registerSamplesAction } from '@/actions/accession.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

/**
 * The "allotted but not yet registered" queue — samples that already have a
 * Sample ID but are still at LIS status 1 ("Sample Sent"), so the worksheet
 * (which filters `sample_status > 1`) cannot show them yet. Complements
 * PendingAccessionsList, which lists orders still MISSING their Sample IDs.
 */
export function PendingRegistrationsList({
  initial,
  variant = 'new',
  canAccession = false,
}: {
  initial: PendingRegistrationsFeed;
  /** Drives the order type fetched and the accession back-link. */
  variant?: 'new' | 'b2b';
  /** Caller holds `order:accession` — shows the Register controls. */
  canAccession?: boolean;
}) {
  const [feed, setFeed] = useState<PendingRegistrationsFeed>(initial);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [registering, setRegistering] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const detailHref = (billId: number) =>
    variant === 'b2b' ? `/orders/new/${billId}?from=b2b` : `/orders/new/${billId}`;

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setFeed(await getPendingRegistrations(variant));
      setPicked(new Set());
    } finally {
      setBusy(false);
    }
  }, [variant]);

  const toggle = useCallback((vailid: string) => {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(vailid)) next.delete(vailid);
      else next.add(vailid);
      return next;
    });
  }, []);

  /**
   * Register the ticked samples. This is a REAL write to the shared LIS — it
   * generates each sample's result skeleton and moves it to 'Sample Registered'
   * — so it is confirmed first and cannot be undone from Telo.
   */
  const register = useCallback(async () => {
    const vailids = [...picked];
    if (vailids.length === 0) return;
    const ok = window.confirm(
      `Register ${vailids.length} sample${vailids.length === 1 ? '' : 's'} to the worksheet?\n\n` +
        `This also bills each test to the client's account at their contracted ` +
        `rate. It writes to the LIS and cannot be undone from Telo.`,
    );
    if (!ok) return;
    setRegistering(true);
    setMsg(null);
    try {
      const res = await registerSamplesAction(vailids, variant);
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.error ?? 'Could not register the samples.' });
        return;
      }
      setMsg({
        kind: 'ok',
        text:
          `Registered ${res.registered} sample${res.registered === 1 ? '' : 's'}` +
          (res.skipped > 0 ? ` · ${res.skipped} skipped (already accessioned)` : '') +
          ' — now on the worksheet.' +
          (res.charged > 0
            ? ` Billed ₹${res.chargeTotal} to the client account (${res.charged} test${res.charged === 1 ? '' : 's'}).`
            : ''),
      });
      await refresh();
    } finally {
      setRegistering(false);
    }
  }, [picked, variant, refresh]);

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
          {canAccession && (
            <Button
              size="sm"
              onClick={register}
              disabled={registering || picked.size === 0}
            >
              {registering
                ? 'Registering…'
                : `Register${picked.size > 0 ? ` (${picked.size})` : ''}`}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {msg && (
        <p
          className={cn(
            'rounded-md border px-3 py-2 text-sm',
            msg.kind === 'ok'
              ? 'border-secondary/30 bg-secondary/10 text-secondary'
              : 'border-destructive/30 bg-destructive/10 text-destructive',
          )}
        >
          {msg.text}
        </p>
      )}

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
              {canAccession && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all pending samples"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    suppressHydrationWarning
                    checked={rows.length > 0 && rows.every((s) => picked.has(s.vailid))}
                    onChange={(e) =>
                      setPicked(
                        e.target.checked
                          ? new Set(rows.map((s) => s.vailid))
                          : new Set(),
                      )
                    }
                  />
                </TableHead>
              )}
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
                <TableCell colSpan={canAccession ? 8 : 7} className="text-muted-foreground">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => (
                <TableRow
                  key={s.sampleId}
                  className={cn(
                    'group transition-transform hover:-translate-y-px',
                    picked.has(s.vailid) && 'bg-primary/5',
                  )}
                >
                  {canAccession && (
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Select sample ${s.vailid}`}
                        className="h-4 w-4 cursor-pointer accent-primary"
                        suppressHydrationWarning
                        checked={picked.has(s.vailid)}
                        onChange={() => toggle(s.vailid)}
                      />
                    </TableCell>
                  )}
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
