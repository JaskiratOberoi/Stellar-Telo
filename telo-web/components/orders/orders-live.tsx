'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  getRecentOrders,
  type RecentFeed,
  type OrdersView,
} from '@/actions/orders.actions';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fmtIST } from '@/lib/datetime';

const POLL_MS = 12_000;

const VIEWS: { id: OrdersView; label: string; hint: string }[] = [
  { id: 'registrations', label: 'Registrations', hint: 'new patients' },
  { id: 'samples', label: 'Samples', hint: 'accessioned SIDs' },
  { id: 'bills', label: 'Bills', hint: 'billed orders' },
];

export function OrdersLive({ initial }: { initial: RecentFeed }) {
  const [data, setData] = useState<RecentFeed>(initial);
  const [view, setView] = useState<OrdersView>(initial.view);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(
    async (forView: OrdersView = view) => {
      const my = ++seq.current;
      setBusy(true);
      try {
        const next = await getRecentOrders(forView, 100);
        if (my === seq.current) setData(next);
      } finally {
        if (my === seq.current) setBusy(false);
      }
    },
    [view],
  );

  // Switching view → immediate refetch (don't wait for the poll).
  useEffect(() => {
    if (view !== data.view) refresh(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [live, refresh]);

  const updated = fmtIST(data.fetchedAt, 'time');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-white/5 bg-card p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={
                'rounded px-3 py-1 text-xs font-medium transition-all duration-150 ' +
                (view === v.id
                  ? 'bg-primary/20 text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5')
              }
              title={v.hint}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {VIEWS.find((v) => v.id === view)?.hint} · {data.scopeCount}{' '}
            centre{data.scopeCount === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                live ? 'animate-pulse bg-secondary' : 'bg-muted-foreground/40'
              }`}
            />
            {live ? 'Live' : 'Paused'} · updated {updated} IST
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh()}
            disabled={busy}
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setLive((v) => !v)}>
            {live ? 'Pause' : 'Resume'}
          </Button>
        </div>
      </div>

      {view === 'bills' && <BillsTable data={data} />}
      {view === 'registrations' && <RegistrationsTable data={data} />}
      {view === 'samples' && <SamplesTable data={data} />}
    </div>
  );
}

function BillsTable({ data }: { data: RecentFeed }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">Bill #</TableHead>
          <TableHead className="w-44">Date</TableHead>
          <TableHead>Patient</TableHead>
          <TableHead className="w-20">MCC</TableHead>
          <TableHead className="w-24 text-right">Amount</TableHead>
          <TableHead className="w-24 text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.bills.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-muted-foreground">
              No bills in your scope yet.
            </TableCell>
          </TableRow>
        ) : (
          data.bills.map((o) => (
            <TableRow key={o.billId}>
              <TableCell>
                <Link
                  href={`/orders/${o.billId}`}
                  className="font-mono text-xs underline"
                >
                  {o.billNumber ?? o.billId}
                </Link>
              </TableCell>
              <TableCell>{fmtIST(o.billDate)}</TableCell>
              <TableCell>{o.patientName ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">
                {o.mccCode ?? '—'}
              </TableCell>
              <TableCell className="text-right">₹{o.amount}</TableCell>
              <TableCell className="text-right">₹{o.balance}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function RegistrationsTable({ data }: { data: RecentFeed }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">PID</TableHead>
          <TableHead className="w-44">Registered</TableHead>
          <TableHead>Patient</TableHead>
          <TableHead className="w-20">Age/Sex</TableHead>
          <TableHead className="w-32">Mobile</TableHead>
          <TableHead className="w-20">MCC</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.registrations.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-muted-foreground">
              No registrations yet.
            </TableCell>
          </TableRow>
        ) : (
          data.registrations.map((p) => (
            <TableRow key={p.patientId}>
              <TableCell className="font-mono text-xs">{p.patientId}</TableCell>
              <TableCell>{fmtIST(p.registeredAt)}</TableCell>
              <TableCell>{p.patientName ?? '—'}</TableCell>
              <TableCell>
                {p.age ?? '—'}
                {p.gender === 1 ? '/M' : p.gender === 2 ? '/F' : ''}
              </TableCell>
              <TableCell>{p.mobile ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">
                {p.mccCode ?? '—'}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function SamplesTable({ data }: { data: RecentFeed }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-32">SID</TableHead>
          <TableHead className="w-44">Accessioned</TableHead>
          <TableHead>Patient</TableHead>
          <TableHead className="w-32">Sample type</TableHead>
          <TableHead>Tests</TableHead>
          <TableHead className="w-28">Status</TableHead>
          <TableHead className="w-20">MCC</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.samples.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-muted-foreground">
              No samples yet.
            </TableCell>
          </TableRow>
        ) : (
          data.samples.map((s) => (
            <TableRow key={s.sampleId}>
              <TableCell className="font-mono text-xs">{s.vailid}</TableCell>
              <TableCell>{fmtIST(s.accessionedAt)}</TableCell>
              <TableCell>{s.patientName ?? '—'}</TableCell>
              <TableCell className="text-xs">
                {s.sampleTypeName ?? '—'}
              </TableCell>
              <TableCell
                className="max-w-[260px] truncate font-mono text-xs"
                title={s.testCodes ?? ''}
              >
                {s.testCodes ?? '—'}
              </TableCell>
              <TableCell className="text-xs">{s.status ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">
                {s.mccCode ?? '—'}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
