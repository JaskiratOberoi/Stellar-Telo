import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getLedgerForMcc } from '@/actions/ledger.actions';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getMccInvoiceConfig } from '@/db/read/invoiceConfig';
import { getReceiptsInPeriod } from '@/db/read/receipts';
import { getMccScope } from '@/auth/scope';
import { fmtIST } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { AccountsReport } from '@/components/balances/accounts-report';
import { PrintReportButton } from '@/components/balances/print-report-button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const today = (): string => new Date().toISOString().slice(0, 10);
const firstOfMonth = (): string => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
// Monday-start week (Indian business convention is Mon–Sun, not Sun–Sat).
const firstOfWeek = (): string => {
  const d = new Date();
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
};
const firstOfYear = (): string => {
  const d = new Date();
  return new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10);
};
// Patient age label — ageType 1=Years (default), 2=Months, 3=Days.
function fmtPatientAge(
  age: number | null,
  ageType: number | null,
): string {
  if (age == null) return '—';
  const unit = ageType === 2 ? 'M' : ageType === 3 ? 'D' : 'Y';
  return `${age}${unit}`;
}

export default async function BalanceMccPage({
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

  // Receipts query is scoped to this MCC only — needs the user's mcc scope
  // to defend against URL-typing, so we fetch scope first then receipts in
  // parallel with the other reads.
  const scope = await getMccScope(user.uid);
  const [data, mccs, invoiceConfig, receipts] = await Promise.all([
    getLedgerForMcc(mccId, { from, to }),
    // Self-include this MCC so its name resolves even if the LIS flags it inactive.
    fetchScopedMccUnits([mccId], [mccId]),
    getMccInvoiceConfig(mccId),
    getReceiptsInPeriod(scope, from, to, { mccId }),
  ]);
  if (scope.length > 0 && scope.length <= 1000 && !scope.includes(mccId)) {
    redirect('/balances');
  }
  const mccMeta = mccs[0];
  // Multi-MCC user → "← Accounts summary" link back to the rollup.
  // Single-MCC user (client account) → no back link; this IS their account.
  const showBackLink = scope.length !== 1;
  const backHref = `/balances?from=${from}&to=${to}`;

  // ── Quick-period presets ────────────────────────────────────────────────
  const td = today();
  const periods = [
    { label: 'Today',      from: td,             to: td },
    { label: 'This week',  from: firstOfWeek(),  to: td },
    { label: 'This month', from: firstOfMonth(), to: td },
    { label: 'This year',  from: firstOfYear(),  to: td },
  ];
  const activePeriod = periods.find((p) => p.from === from && p.to === to);

  // ── Summary aggregates ─────────────────────────────────────────────────
  // Bill-date-keyed (what was billed in the window):
  const totalAmount = data.bills.reduce((s, b) => s + b.amount, 0);
  const pendingBills = data.bills.filter((b) => b.balance > 0).length;
  // Receipt-date-keyed (what was actually collected in the window):
  // see db/read/receipts.ts — payments recorded today against any bill
  // roll up here, never into prior days' totals.
  const totalPaid  = receipts.collected;
  const cashPaid   = receipts.cashCollected;
  const otherPaid  = receipts.otherCollected;
  const cashCount  = receipts.cashCount;
  const otherCount = receipts.otherCount;

  return (
    <div>
      {/* ── Print view: A4 account statement ───────────────────────── */}
      <div className="hidden print:block">
        <AccountsReport
          mccName={mccMeta?.name ?? null}
          mccCode={mccMeta?.code ?? null}
          invoiceConfig={invoiceConfig}
          from={from}
          to={to}
          bills={data.bills}
          receiptsByBill={data.receiptsByBill}
          totalBalance={data.totalBalance}
          receipts={receipts}
        />
      </div>

      {/* ── Screen view: interactive ledger ────────────────────────── */}
      <div className="space-y-4 print:hidden">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {mccMeta?.name ?? `MCC ${mccId}`}{' '}
            <span className="font-mono text-base text-muted-foreground">
              {mccMeta?.code ?? mccId}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.bills.length} Telo bill
            {data.bills.length === 1 ? '' : 's'} · {inr(data.totalBalance)}{' '}
            balance · {fmtIST(from, 'date')} → {fmtIST(to, 'date')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PrintReportButton />
          {showBackLink && (
            <Link href={backHref} className="text-sm underline">
              ← Accounts summary
            </Link>
          )}
        </div>
      </div>

      {/* ── Period quick-select ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Period
        </span>
        {periods.map((p) => {
          const active = p.label === activePeriod?.label;
          return (
            <Link
              key={p.label}
              href={`/balances/${mccId}?from=${p.from}&to=${p.to}`}
              className={cn(
                'rounded-full px-3 py-1 text-xs transition-all duration-150',
                active
                  ? 'bg-primary/20 text-foreground font-medium'
                  : 'border border-white/10 text-muted-foreground hover:bg-white/5 hover:text-foreground',
              )}
            >
              {p.label}
            </Link>
          );
        })}
        {!activePeriod && (
          <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-muted-foreground">
            Custom range
          </span>
        )}
      </div>

      {/* ── Summary cards ──────────────────────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total billed"
          value={inr(totalAmount)}
          hint={`${data.bills.length} bill${data.bills.length === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Collected in period"
          value={inr(totalPaid)}
          hint={`${receipts.receiptCount} payment${receipts.receiptCount === 1 ? '' : 's'} received · keyed by receipt date`}
          variant="positive"
          breakdown={[
            { label: 'Cash', value: inr(cashPaid), sub: `${cashCount} payment${cashCount === 1 ? '' : 's'}` },
            { label: 'Others', value: inr(otherPaid), sub: `${otherCount} payment${otherCount === 1 ? '' : 's'}` },
            ...(receipts.refunded > 0
              ? [{ label: 'Refunded', value: `− ${inr(receipts.refunded)}` }]
              : []),
          ]}
        />
        <StatCard
          label="Balance due"
          value={inr(data.totalBalance)}
          hint={pendingBills === 0 ? 'All settled' : `${pendingBills} bill${pendingBills === 1 ? '' : 's'} pending`}
          variant={data.totalBalance > 0 ? 'warning' : 'muted'}
        />
        <StatCard
          label="Avg bill"
          value={inr(data.bills.length > 0 ? Math.round(totalAmount / data.bills.length) : 0)}
          hint={fmtIST(from, 'date') + ' → ' + fmtIST(to, 'date')}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Bill #</TableHead>
            <TableHead className="w-28">Date</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead>Ref. doctor</TableHead>
            <TableHead>Ref. customer</TableHead>
            <TableHead className="w-24">Payment</TableHead>
            <TableHead className="w-14 text-right">Age</TableHead>
            <TableHead className="w-24 text-right">Amount</TableHead>
            <TableHead className="w-24 text-right">Paid</TableHead>
            <TableHead className="w-24 text-right">Balance</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.bills.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="text-muted-foreground">
                No Telo bills for this client in this date range.
              </TableCell>
            </TableRow>
          ) : (
            data.bills.map((b) => {
              const detailHref = `/orders/${b.billId}?back=${encodeURIComponent(`/balances/${mccId}?from=${from}&to=${to}`)}`;
              return (
                <TableRow key={b.billId}>
                  <TableCell>
                    <Link
                      href={detailHref}
                      className="font-mono text-xs underline"
                    >
                      {b.billNumber ?? b.billId}
                    </Link>
                  </TableCell>
                  <TableCell>{fmtIST(b.billDate, 'date')}</TableCell>
                  <TableCell>{b.patientName ?? '—'}</TableCell>
                  <TableCell className="text-sm">
                    {b.doctorName ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {b.customerName ?? (
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
                    {inr(b.amountPaid)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {inr(b.balance)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={detailHref}
                      className="inline-flex items-center justify-center rounded-md border border-white/10 px-2.5 py-1 text-xs text-muted-foreground transition-all duration-150 hover:bg-white/5 hover:text-foreground hover:border-white/20"
                    >
                      View →
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      </div>{/* end screen view */}
    </div>
  );
}

// ── Summary stat card ──────────────────────────────────────────────────────
// Server-rendered, no client interactivity. `variant` shifts only the value's
// colour so the visual hierarchy reads at a glance.
function StatCard({
  label,
  value,
  hint,
  variant = 'default',
  breakdown,
}: {
  label: string;
  value: string;
  hint?: string;
  variant?: 'default' | 'positive' | 'warning' | 'muted';
  breakdown?: { label: string; value: string; sub?: string }[];
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
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-1 text-2xl font-bold tracking-tight', valueColor)}>
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      )}
      {breakdown && breakdown.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-white/5 pt-2">
          {breakdown.map((b) => (
            <div key={b.label} className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">{b.label}</span>
              <span>
                <span className="font-medium">{b.value}</span>
                {b.sub && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    · {b.sub}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
