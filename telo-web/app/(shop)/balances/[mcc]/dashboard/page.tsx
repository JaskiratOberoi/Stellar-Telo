import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  Hourglass,
  Percent,
  ReceiptText,
  TrendingUp,
  Undo2,
  Wallet,
} from 'lucide-react';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getClientAccountingDashboard } from '@/actions/accounting.actions';
import { fmtIST, todayIST, addDaysIST, firstOfMonthIST } from '@/lib/datetime';
import { StatCard } from '@/components/ui/stat-card';
import { BalanceViewTabs } from '@/components/balances/balance-view-tabs';
import { AccountingFilters } from '@/components/balances/accounting-filters';
import { AccountingCharts } from '@/components/balances/accounting-charts';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const today = (): string => todayIST();
const firstOfMonth = (): string => firstOfMonthIST();
const firstOfWeek = (): string => {
  const t = todayIST();
  const [y, m, d] = t.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysIST(t, diff);
};
const firstOfYear = (): string => `${todayIST().slice(0, 4)}-01-01`;

export default async function ClientDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ mcc: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { mcc } = await params;
  const mccId = Number(mcc);
  if (!Number.isInteger(mccId)) notFound();

  const user = await requireSession();
  if (!hasCapability(user.caps, 'balance:view')) redirect('/dashboard');

  const sp = await searchParams;
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : firstOfMonth();
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today();

  const scope = await getMccScope(user.uid);
  // Dashboard is a multi-client (admin) view — single-client users get the bills page.
  if (scope.length === 1) redirect(`/balances/${mccId}?from=${from}&to=${to}`);
  if (scope.length > 0 && scope.length <= 1000 && !scope.includes(mccId)) {
    redirect('/balances');
  }

  const [dash, mccs] = await Promise.all([
    getClientAccountingDashboard(mccId, { from, to }),
    fetchScopedMccUnits([mccId], [mccId]),
  ]);
  const mccMeta = mccs[0];
  const t = dash.totals;

  // Quick-period presets.
  const td = today();
  const periods = [
    { label: 'Today', from: td, to: td },
    { label: 'This week', from: firstOfWeek(), to: td },
    { label: 'This month', from: firstOfMonth(), to: td },
    { label: 'This year', from: firstOfYear(), to: td },
  ];
  const activeLabel = periods.find((p) => p.from === from && p.to === to)?.label ?? null;

  // Day-wise table: only days with activity, newest first.
  const activeDays = dash.daily
    .filter((d) => d.bills > 0 || d.collected > 0 || d.refunded > 0)
    .reverse();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-3">
        <div className="min-w-0 animate-fade-in-up motion-reduce:animate-none">
          <Link
            href={`/balances?from=${from}&to=${to}`}
            className="mb-1.5 inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Accounts summary
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            {mccMeta?.name ?? `MCC ${mccId}`}{' '}
            <span className="font-mono text-base font-medium text-muted-foreground">
              {mccMeta?.code ?? mccId}
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Accounting dashboard · {fmtIST(from, 'date')} → {fmtIST(to, 'date')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <BalanceViewTabs mccId={mccId} from={from} to={to} active="dashboard" />
        </div>
      </div>

      <AccountingFilters
        mccId={mccId}
        from={from}
        to={to}
        periods={periods}
        activeLabel={activeLabel}
        maxDate={td}
      />

      {/* KPI cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="animate-fade-in-up motion-reduce:animate-none">
          <StatCard label="Total billed" value={inr(t.charges)} hint={`${t.bills.toLocaleString('en-IN')} bill${t.bills === 1 ? '' : 's'}`} icon={<ReceiptText />} />
        </div>
        <div className="animate-fade-in-up motion-reduce:animate-none [animation-delay:70ms]">
          <StatCard label="Net (after discount)" value={inr(t.net)} hint={`Discount ${inr(t.discount)}`} icon={<Percent />} />
        </div>
        <div className="animate-fade-in-up motion-reduce:animate-none [animation-delay:140ms]">
          <StatCard
            label="Collected in period"
            value={inr(t.collected)}
            variant="positive"
            hint={`Cash ${inr(t.cashCollected)} · Other ${inr(t.otherCollected)}`}
            icon={<Wallet />}
          />
        </div>
        <div className="animate-fade-in-up motion-reduce:animate-none [animation-delay:210ms]">
          <StatCard
            label="Outstanding balance"
            value={inr(t.balance)}
            variant={t.balance > 0 ? 'warning' : 'muted'}
            hint={`${t.collectionRate}% collected of net`}
            icon={<Hourglass />}
          />
        </div>
        <div className="animate-fade-in-up motion-reduce:animate-none [animation-delay:280ms]">
          <StatCard label="Avg bill" value={inr(t.avgBill)} icon={<TrendingUp />} />
        </div>
        <div className="animate-fade-in-up motion-reduce:animate-none [animation-delay:350ms]">
          <StatCard label="Refunds" value={inr(t.refunded)} variant={t.refunded > 0 ? 'warning' : 'muted'} icon={<Undo2 />} />
        </div>
        <div className="animate-fade-in-up motion-reduce:animate-none [animation-delay:420ms]">
          <StatCard label="Cash collected" value={inr(t.cashCollected)} icon={<Banknote />} />
        </div>
        <div className="animate-fade-in-up motion-reduce:animate-none [animation-delay:490ms]">
          <StatCard label="Other collected" value={inr(t.otherCollected)} hint="UPI / Card / Cheque / Online" icon={<CreditCard />} />
        </div>
      </div>

      {/* Charts */}
      <AccountingCharts
        daily={dash.daily}
        paymentModes={dash.paymentModes}
        cashCredit={dash.cashCredit}
        aging={dash.aging}
      />

      {/* Day-wise revenue table */}
      <Section title="Day-wise revenue" hint="Charges by bill date · Collected by receipt date">
        <div className="max-h-[28rem] overflow-auto rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Bills</TableHead>
                <TableHead className="text-right">Charges</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Collected</TableHead>
                <TableHead className="text-right">Refund</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeDays.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    No activity in this date range.
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  <TableRow className="bg-muted/50 font-semibold tabular-nums">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{t.bills}</TableCell>
                    <TableCell className="text-right">{inr(t.charges)}</TableCell>
                    <TableCell className="text-right">{inr(t.discount)}</TableCell>
                    <TableCell className="text-right">{inr(t.net)}</TableCell>
                    <TableCell className="text-right text-success">{inr(t.collected)}</TableCell>
                    <TableCell className="text-right">{inr(t.refunded)}</TableCell>
                    <TableCell className="text-right">{inr(t.balance)}</TableCell>
                  </TableRow>
                  {activeDays.map((d) => (
                    <TableRow key={d.day} className="tabular-nums">
                      <TableCell className="whitespace-nowrap">{fmtIST(d.day, 'date')}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{d.bills}</TableCell>
                      <TableCell className="text-right">{inr(d.charges)}</TableCell>
                      <TableCell className="text-right">{inr(d.discount)}</TableCell>
                      <TableCell className="text-right">{inr(d.net)}</TableCell>
                      <TableCell className="text-right text-success">{inr(d.collected)}</TableCell>
                      <TableCell className="text-right">{d.refunded > 0 ? inr(d.refunded) : '—'}</TableCell>
                      <TableCell className="text-right">{inr(d.balance)}</TableCell>
                    </TableRow>
                  ))}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </Section>

      {/* Breakdown tables */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Outstanding aging" hint="Unpaid balance by age of bill · as of now">
          <SimpleTable
            cols={['Age', 'Bills', 'Balance']}
            rows={dash.aging.map((a) => [a.bucket, String(a.bills), inr(a.balance)])}
            rightFrom={1}
          />
        </Section>

        <Section title="By registering account" hint="Which Telo login drove the billing">
          <SimpleTable
            cols={['Account', 'Bills', 'Charges']}
            rows={dash.registrars.map((r) => [
              r.username ?? r.name ?? '—',
              String(r.bills),
              inr(r.charges),
            ])}
            rightFrom={1}
            empty="No Telo bills in this range."
          />
        </Section>

        <Section title="Top referring doctors">
          <SimpleTable
            cols={['Doctor', 'Bills', 'Charges']}
            rows={dash.topDoctors.map((r) => [r.name, String(r.bills), inr(r.charges)])}
            rightFrom={1}
            empty="No bills in this range."
          />
        </Section>

        <Section title="Top referring customers">
          <SimpleTable
            cols={['Customer', 'Bills', 'Charges']}
            rows={dash.topCustomers.map((r) => [r.name, String(r.bills), inr(r.charges)])}
            rightFrom={1}
            empty="No bills in this range."
          />
        </Section>
      </div>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 animate-fade-in motion-reduce:animate-none">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function SimpleTable({
  cols,
  rows,
  rightFrom = 999,
  empty = 'No data.',
}: {
  cols: string[];
  rows: string[][];
  /** Column index from which cells are right-aligned (numeric columns). */
  rightFrom?: number;
  empty?: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {cols.map((c, i) => (
            <TableHead key={c} className={i >= rightFrom ? 'text-right' : undefined}>
              {c}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={cols.length} className="text-muted-foreground">
              {empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r, ri) => (
            <TableRow key={ri}>
              {r.map((cell, ci) => (
                <TableCell
                  key={ci}
                  className={ci >= rightFrom ? 'text-right tabular-nums' : undefined}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
