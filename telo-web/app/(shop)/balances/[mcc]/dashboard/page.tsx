import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getClientAccountingDashboard } from '@/actions/accounting.actions';
import { fmtIST, todayIST, addDaysIST, firstOfMonthIST } from '@/lib/datetime';
import { cn } from '@/lib/utils';
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
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {mccMeta?.name ?? `MCC ${mccId}`}{' '}
            <span className="font-mono text-base text-muted-foreground">
              {mccMeta?.code ?? mccId}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Accounting dashboard · {fmtIST(from, 'date')} → {fmtIST(to, 'date')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <BalanceViewTabs mccId={mccId} from={from} to={to} active="dashboard" />
          <Link href={`/balances?from=${from}&to=${to}`} className="text-sm underline">
            ← Accounts summary
          </Link>
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
        <StatCard label="Total billed" value={inr(t.charges)} hint={`${t.bills.toLocaleString('en-IN')} bill${t.bills === 1 ? '' : 's'}`} />
        <StatCard label="Net (after discount)" value={inr(t.net)} hint={`Discount ${inr(t.discount)}`} />
        <StatCard
          label="Collected in period"
          value={inr(t.collected)}
          variant="positive"
          hint={`Cash ${inr(t.cashCollected)} · Other ${inr(t.otherCollected)}`}
        />
        <StatCard
          label="Outstanding balance"
          value={inr(t.balance)}
          variant={t.balance > 0 ? 'warning' : 'muted'}
          hint={`${t.collectionRate}% collected of net`}
        />
        <StatCard label="Avg bill" value={inr(t.avgBill)} />
        <StatCard label="Refunds" value={inr(t.refunded)} variant={t.refunded > 0 ? 'warning' : 'muted'} />
        <StatCard label="Cash collected" value={inr(t.cashCollected)} />
        <StatCard label="Other collected" value={inr(t.otherCollected)} hint="UPI / Card / Cheque / Online" />
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
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-white/5">
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
                  <TableRow className="bg-white/[0.03] font-medium">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{t.bills}</TableCell>
                    <TableCell className="text-right">{inr(t.charges)}</TableCell>
                    <TableCell className="text-right">{inr(t.discount)}</TableCell>
                    <TableCell className="text-right">{inr(t.net)}</TableCell>
                    <TableCell className="text-right text-secondary">{inr(t.collected)}</TableCell>
                    <TableCell className="text-right">{inr(t.refunded)}</TableCell>
                    <TableCell className="text-right">{inr(t.balance)}</TableCell>
                  </TableRow>
                  {activeDays.map((d) => (
                    <TableRow key={d.day}>
                      <TableCell className="whitespace-nowrap">{fmtIST(d.day, 'date')}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{d.bills}</TableCell>
                      <TableCell className="text-right">{inr(d.charges)}</TableCell>
                      <TableCell className="text-right">{inr(d.discount)}</TableCell>
                      <TableCell className="text-right">{inr(d.net)}</TableCell>
                      <TableCell className="text-right text-secondary">{inr(d.collected)}</TableCell>
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
function StatCard({
  label,
  value,
  hint,
  variant = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  variant?: 'default' | 'positive' | 'warning' | 'muted';
}) {
  const valueColor =
    variant === 'positive'
      ? 'text-secondary'
      : variant === 'warning'
        ? 'text-destructive'
        : variant === 'muted'
          ? 'text-muted-foreground'
          : 'text-foreground';
  return (
    <div className="rounded-xl border border-white/5 bg-card p-4">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tracking-tight', valueColor)}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

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
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
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
    <div className="rounded-lg border border-white/5">
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
                  <TableCell key={ci} className={ci >= rightFrom ? 'text-right' : undefined}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
