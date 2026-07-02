'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  searchAccountsBills,
  type AccountsSummary,
  type AccountsSearchResult,
  type PaymentModeFilter,
} from '@/actions/ledger.actions';
import type { ScopedMcc } from '@/db/read/mccUnits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fmtIST,
  todayIST,
  addDaysIST,
  firstOfMonthIST,
  firstOfLastMonthIST,
  lastDayOfLastMonthIST,
} from '@/lib/datetime';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
// IST calendar-day boundaries (see lib/datetime). UTC-based dates made the
// quick filters resolve to the previous day between 00:00–05:30 IST.
const today = () => todayIST();
const firstOfThisMonth = () => firstOfMonthIST();
const firstOfLastMonth = () => firstOfLastMonthIST();
const lastDayOfLastMonth = () => lastDayOfLastMonthIST();
const yesterday = () => addDaysIST(todayIST(), -1);

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

  // Free-text search across the active range/scope/filters. Empty → show the
  // per-MCC rollup; non-empty → show matching bills.
  const [q, setQ] = useState('');
  const [searching, startSearch] = useTransition();
  const [results, setResults] = useState<AccountsSearchResult['bills'] | null>(null);
  const searchSeq = useRef(0);
  useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      const seq = ++searchSeq.current;
      startSearch(async () => {
        const res = await searchAccountsBills({ from, to, q: needle, mccId, paymentMode: pay });
        if (seq === searchSeq.current) setResults(res.bills);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [q, from, to, mccId, pay]);

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
              className="h-8 w-full sm:w-40"
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
              className="h-8 w-full sm:w-40"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-full border border-border/70 bg-card p-1 shadow-elevation-1">
            {presets().map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyDates(p.from, p.to)}
                disabled={pending}
                aria-pressed={activePresetId === p.id}
                className={
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ' +
                  (activePresetId === p.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground')
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
              className="h-8 w-full sm:w-44 rounded-lg border border-border bg-input px-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50"
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
              className="h-8 w-full sm:w-32 rounded-lg border border-border bg-input px-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/60"
            >
              <option value="all">All</option>
              <option value="cash">Cash / Paying</option>
              <option value="credit">Credit</option>
            </select>
          </div>
          <div className="space-y-0.5">
            <label className="text-xs text-muted-foreground">Search</label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Patient, bill #, doctor…"
              className="h-8 w-full sm:w-56"
              suppressHydrationWarning
            />
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

      {q.trim() ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {searching
              ? 'Searching…'
              : `${(results ?? []).length} matching bill${(results ?? []).length === 1 ? '' : 's'}${(results ?? []).length === 200 ? '+ (showing first 200)' : ''} for “${q.trim()}”`}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead className="w-28">Bill #</TableHead>
                <TableHead className="w-36">Date</TableHead>
                <TableHead>Doctor / Customer</TableHead>
                <TableHead className="w-28">Payment</TableHead>
                <TableHead className="w-24 text-right">Amount</TableHead>
                <TableHead className="w-24 text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(results ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    {searching ? 'Searching…' : 'No matching bills.'}
                  </TableCell>
                </TableRow>
              ) : (
                (results ?? []).map((b) => (
                  <TableRow key={b.billId}>
                    <TableCell className="font-medium">
                      {b.patientName ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {b.billNumber ?? b.billId}
                    </TableCell>
                    <TableCell className="text-xs">{fmtIST(b.billDate)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[b.doctorName, b.customerName].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="text-xs">{b.paymentType ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(b.amount)}</TableCell>
                    <TableCell
                      className={
                        'text-right font-semibold tabular-nums' +
                        (b.balance < 0 ? ' text-destructive' : '')
                      }
                    >
                      {inr(b.balance)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
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
              <TableRow
                key={r.mccId}
                onClick={() =>
                  router.push(`/balances/${r.mccId}/dashboard?from=${from}&to=${to}`)
                }
                className="cursor-pointer"
              >
                <TableCell>
                  <span className="font-medium text-primary underline-offset-2 hover:underline">
                    {r.mccCode || r.mccId}
                  </span>
                  {r.mccName && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      · {r.mccName}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {r.bills}
                </TableCell>
                <TableCell className="text-right tabular-nums">{inr(r.charges)}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(r.discount)}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(r.net)}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(r.received)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {inr(r.refund)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {inr(r.payingBalance)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {inr(r.creditBalance)}
                </TableCell>
                <TableCell
                  className={
                    'text-right font-semibold tabular-nums' +
                    (r.balance < 0 ? ' text-destructive' : '')
                  }
                >
                  {inr(r.balance)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-border/70 bg-success/10 font-semibold tabular-nums text-success">
              <td className="px-2 py-2 text-sm">Total</td>
              <td className="px-2 py-2 text-right text-xs">{totals.bills}</td>
              <td className="px-2 py-2 text-right">{inr(totals.charges)}</td>
              <td className="px-2 py-2 text-right">{inr(totals.discount)}</td>
              <td className="px-2 py-2 text-right">{inr(totals.net)}</td>
              <td className="px-2 py-2 text-right">{inr(totals.received)}</td>
              <td className="px-2 py-2 text-right opacity-60">
                {inr(totals.refund)}
              </td>
              <td className="px-2 py-2 text-right">{inr(totals.payingBalance)}</td>
              <td className="px-2 py-2 text-right">{inr(totals.creditBalance)}</td>
              <td className="px-2 py-2 text-right">{inr(totals.balance)}</td>
            </tr>
          </tfoot>
        )}
      </Table>
      )}

      <p className="text-[11px] italic text-muted-foreground">
        Net = Charges − Discount. Received is net of refunds (amount_paid is
        decremented when a refund is recorded), so Balance = Net − Received =
        Paying + Credit. The Refund column is the total of refunds recorded on
        the period's bills (informational).
      </p>
    </div>
  );
}
