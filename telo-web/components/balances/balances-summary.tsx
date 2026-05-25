'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  AccountsSummary,
  PaymentModeFilter,
} from '@/actions/ledger.actions';
import type { ScopedMcc } from '@/db/read/mccUnits';
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

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const today = () => new Date().toISOString().slice(0, 10);
const firstOfThisMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const firstOfLastMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - 1, 1)
    .toISOString()
    .slice(0, 10);
};
const lastDayOfLastMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10);
};
const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

interface Preset {
  id: 'today' | 'yesterday' | 'this-month' | 'last-month';
  label: string;
  from: string;
  to: string;
}

function presets(): Preset[] {
  return [
    { id: 'today', label: 'Today', from: today(), to: today() },
    {
      id: 'yesterday',
      label: 'Yesterday',
      from: yesterday(),
      to: yesterday(),
    },
    {
      id: 'this-month',
      label: 'This month',
      from: firstOfThisMonth(),
      to: today(),
    },
    {
      id: 'last-month',
      label: 'Last month',
      from: firstOfLastMonth(),
      to: lastDayOfLastMonth(),
    },
  ];
}

export function AccountsSummaryView({
  initial,
  mccs,
}: {
  initial: AccountsSummary;
  mccs: ScopedMcc[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [from, setFrom] = useState(initial.range.from);
  const [to, setTo] = useState(initial.range.to);
  const [mccId, setMccId] = useState<number | null>(initial.filters.mccId);
  const [pay, setPay] = useState<PaymentModeFilter>(initial.filters.paymentMode);

  function navigate(next: {
    from: string;
    to: string;
    mccId: number | null;
    pay: PaymentModeFilter;
  }) {
    const sp = new URLSearchParams(params.toString());
    sp.set('from', next.from);
    sp.set('to', next.to);
    if (next.mccId != null) sp.set('mcc', String(next.mccId));
    else sp.delete('mcc');
    if (next.pay !== 'all') sp.set('pay', next.pay);
    else sp.delete('pay');
    startTransition(() => router.replace(`/balances?${sp.toString()}`));
  }

  function applyDates(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    navigate({ from: nextFrom, to: nextTo, mccId, pay });
  }
  function applyMcc(next: number | null) {
    setMccId(next);
    navigate({ from, to, mccId: next, pay });
  }
  function applyPay(next: PaymentModeFilter) {
    setPay(next);
    navigate({ from, to, mccId, pay: next });
  }

  const activePresetId = presets().find(
    (p) => p.from === from && p.to === to,
  )?.id;

  const { rows, totals } = initial;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5">
            <label className="text-xs text-muted-foreground">From</label>
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(e) => applyDates(e.target.value || today(), to)}
              className="h-8 w-40"
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-xs text-muted-foreground">To</label>
            <Input
              type="date"
              value={to}
              min={from}
              max={today()}
              onChange={(e) => applyDates(from, e.target.value || today())}
              className="h-8 w-40"
            />
          </div>
          <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-1">
            {presets().map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyDates(p.from, p.to)}
                disabled={pending}
                className={
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors ' +
                  (activePresetId === p.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="space-y-0.5">
            <label className="text-xs text-muted-foreground">Center</label>
            <select
              value={mccId == null ? '' : String(mccId)}
              onChange={(e) =>
                applyMcc(e.target.value === '' ? null : Number(e.target.value))
              }
              disabled={pending || mccs.length === 0}
              suppressHydrationWarning
              className="h-8 w-44 rounded-md border border-input bg-transparent px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">All centers</option>
              {mccs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code}
                  {m.name ? ` · ${m.name}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-0.5">
            <label className="text-xs text-muted-foreground">Payment</label>
            <select
              value={pay}
              onChange={(e) => applyPay(e.target.value as PaymentModeFilter)}
              disabled={pending}
              suppressHydrationWarning
              className="h-8 w-32 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="all">All</option>
              <option value="cash">Cash / Paying</option>
              <option value="credit">Credit</option>
            </select>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Telo bills only · {totals.bills.toLocaleString('en-IN')} bill
          {totals.bills === 1 ? '' : 's'} ·{' '}
          {initial.scopeCount.toLocaleString('en-IN')} centre
          {initial.scopeCount === 1 ? '' : 's'} in scope · updated{' '}
          {fmtIST(initial.fetchedAt, 'time')} IST
          {pending && ' · refreshing…'}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-44">Center</TableHead>
            <TableHead className="w-16 text-right">Bills</TableHead>
            <TableHead className="w-24 text-right">Charges</TableHead>
            <TableHead className="w-24 text-right">Discount</TableHead>
            <TableHead className="w-24 text-right">Net</TableHead>
            <TableHead className="w-24 text-right">Received</TableHead>
            <TableHead className="w-24 text-right">Refund</TableHead>
            <TableHead className="w-28 text-right">Paying</TableHead>
            <TableHead className="w-28 text-right">Credit</TableHead>
            <TableHead className="w-28 text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="text-muted-foreground">
                No Telo bills in this range.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.mccId}>
                <TableCell>
                  <Link
                    href={`/balances/${r.mccId}?from=${from}&to=${to}${pay !== 'all' ? `&pay=${pay}` : ''}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {r.mccCode || r.mccId}
                  </Link>
                  {r.mccName && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      · {r.mccName}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {r.bills}
                </TableCell>
                <TableCell className="text-right">{inr(r.charges)}</TableCell>
                <TableCell className="text-right">{inr(r.discount)}</TableCell>
                <TableCell className="text-right">{inr(r.net)}</TableCell>
                <TableCell className="text-right">{inr(r.received)}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {inr(r.refund)}
                </TableCell>
                <TableCell className="text-right">
                  {inr(r.payingBalance)}
                </TableCell>
                <TableCell className="text-right">
                  {inr(r.creditBalance)}
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {inr(r.balance)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 bg-muted/40 font-semibold">
              <td className="px-2 py-2 text-sm">Total</td>
              <td className="px-2 py-2 text-right text-xs">{totals.bills}</td>
              <td className="px-2 py-2 text-right">{inr(totals.charges)}</td>
              <td className="px-2 py-2 text-right">{inr(totals.discount)}</td>
              <td className="px-2 py-2 text-right">{inr(totals.net)}</td>
              <td className="px-2 py-2 text-right">{inr(totals.received)}</td>
              <td className="px-2 py-2 text-right text-muted-foreground">
                {inr(totals.refund)}
              </td>
              <td className="px-2 py-2 text-right">{inr(totals.payingBalance)}</td>
              <td className="px-2 py-2 text-right">{inr(totals.creditBalance)}</td>
              <td className="px-2 py-2 text-right">{inr(totals.balance)}</td>
            </tr>
          </tfoot>
        )}
      </Table>

      <p className="text-[11px] italic text-muted-foreground">
        Net = Charges − Discount. Received is net of refunds (amount_paid is
        decremented when a refund is recorded), so Balance = Net − Received =
        Paying + Credit. The Refund column is the total of refunds recorded on
        the period's bills (informational).
      </p>
    </div>
  );
}
