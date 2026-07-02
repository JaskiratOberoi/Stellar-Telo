import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Banknote, Hourglass, ReceiptText, Wallet } from 'lucide-react';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getLedgerForMcc } from '@/actions/ledger.actions';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getMccInvoiceConfig } from '@/db/read/invoiceConfig';
import { getReceiptsInPeriod } from '@/db/read/receipts';
import { getMccScope } from '@/auth/scope';
import { fmtIST, todayIST, addDaysIST, firstOfMonthIST } from '@/lib/datetime';
import { getUnpinnedBillIds } from '@/db/pins';
import { StatCard } from '@/components/ui/stat-card';
import { AccountsReport } from '@/components/balances/accounts-report';
import { MccBalanceFilters } from '@/components/balances/mcc-balance-filters';
import { BalancesBillsTable } from '@/components/balances/balances-bills-table';
import { BalanceViewTabs } from '@/components/balances/balance-view-tabs';
import { PrintReportButton } from '@/components/balances/print-report-button';
import { ExportBillsButton } from '@/components/balances/export-bills-button';

export const dynamic = 'force-dynamic';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
// IST calendar-day boundaries (see lib/datetime) — UTC dates skewed these by a
// day in the early-IST-morning window.
const today = (): string => todayIST();
const firstOfMonth = (): string => firstOfMonthIST();
// Monday-start week (Indian business convention is Mon–Sun, not Sun–Sat).
const firstOfWeek = (): string => {
  const t = todayIST();
  const [y, m, d] = t.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysIST(t, diff);
};
const firstOfYear = (): string => `${todayIST().slice(0, 4)}-01-01`;

export default async function BalanceMccPage({
  params,
  searchParams,
}: {
  params: Promise<{ mcc: string }>;
  searchParams: Promise<{ from?: string; to?: string; mine?: string }>;
}) {
  const { mcc } = await params;
  const mccId = Number(mcc);
  if (!Number.isInteger(mccId)) notFound();

  const user = await requireSession();
  if (!hasCapability(user.caps, 'balance:view')) redirect('/dashboard');

  const sp = await searchParams;
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : firstOfMonth();
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today();
  // "My Accounts Summary" filter: only bills this Telo user registered.
  const mine = sp.mine === '1';

  // Receipts query is scoped to this MCC only — needs the user's mcc scope
  // to defend against URL-typing, so we fetch scope first then receipts in
  // parallel with the other reads.
  const scope = await getMccScope(user.uid);
  const [data, mccs, invoiceConfig, receipts] = await Promise.all([
    getLedgerForMcc(mccId, { from, to, mine }),
    // Self-include this MCC so its name resolves even if the LIS flags it inactive.
    fetchScopedMccUnits([mccId], [mccId]),
    getMccInvoiceConfig(mccId),
    // Keep the "Collected in period" card consistent with the filtered bills:
    // when "mine" is on, scope receipts to bills this user registered too.
    getReceiptsInPeriod(scope, from, to, {
      mccId,
      registeredByUserId: mine ? user.uid : null,
    }),
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

  // Negative-balance bills are pinned to the top by default; load this user's
  // unpin exceptions so the client table can render the right pin state. Only
  // negative bills are pinnable, so the lookup set is naturally small.
  const negativeBillIds = data.bills
    .filter((b) => b.balance < 0)
    .map((b) => b.billId);
  const unpinnedIds = await getUnpinnedBillIds(user.uid, negativeBillIds);

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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
        <div className="min-w-0 animate-fade-in-up motion-reduce:animate-none">
          {showBackLink && (
            <Link
              href={backHref}
              className="mb-1.5 inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Accounts summary
            </Link>
          )}
          <h1 className="text-2xl font-bold tracking-tight">
            {mccMeta?.name ?? `MCC ${mccId}`}{' '}
            <span className="font-mono text-base font-medium text-muted-foreground">
              {mccMeta?.code ?? mccId}
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.bills.length} Telo bill
            {data.bills.length === 1 ? '' : 's'}
            {mine ? ' (yours)' : ''} ·{' '}
            <span className="tabular-nums">{inr(data.totalBalance)}</span>{' '}
            balance · {fmtIST(from, 'date')} → {fmtIST(to, 'date')}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {showBackLink && (
            <BalanceViewTabs mccId={mccId} from={from} to={to} active="bills" />
          )}
          <ExportBillsButton
            bills={data.bills}
            receiptsByBill={data.receiptsByBill}
            fileName={`${mccMeta?.code ?? mccId}_accounts_${from}_${to}.xlsx`}
          />
          <PrintReportButton />
        </div>
      </div>

      {/* Period quick-select + "My Accounts Summary" registrar filter.
          Client-side router navigation (see MccBalanceFilters) so repeated
          query-only filter changes always re-fetch — avoids the Next.js 15
          stale Router Cache bug that plain <Link> hit here. */}
      <MccBalanceFilters
        mccId={mccId}
        from={from}
        to={to}
        mine={mine}
        periods={periods}
        activeLabel={activePeriod?.label ?? null}
        userLabel={user.name || user.username}
        maxDate={td}
      />

      {/* ── Summary cards ──────────────────────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="animate-fade-in-up motion-reduce:animate-none">
          <StatCard
            label="Total billed"
            value={inr(totalAmount)}
            hint={`${data.bills.length} bill${data.bills.length === 1 ? '' : 's'}`}
            icon={<ReceiptText />}
          />
        </div>
        <div className="animate-fade-in-up motion-reduce:animate-none [animation-delay:70ms]">
          <StatCard
            label="Collected in period"
            value={inr(totalPaid)}
            hint={`${receipts.receiptCount} payment${receipts.receiptCount === 1 ? '' : 's'} received · keyed by receipt date`}
            variant="positive"
            icon={<Wallet />}
            breakdown={[
              { label: 'Cash', value: inr(cashPaid), sub: `${cashCount} payment${cashCount === 1 ? '' : 's'}` },
              { label: 'Others', value: inr(otherPaid), sub: `${otherCount} payment${otherCount === 1 ? '' : 's'}` },
              ...(receipts.refunded > 0
                ? [{ label: 'Refunded', value: `− ${inr(receipts.refunded)}` }]
                : []),
            ]}
          />
        </div>
        <div className="animate-fade-in-up motion-reduce:animate-none [animation-delay:140ms]">
          <StatCard
            label="Balance due"
            value={inr(data.totalBalance)}
            hint={pendingBills === 0 ? 'All settled' : `${pendingBills} bill${pendingBills === 1 ? '' : 's'} pending`}
            variant={data.totalBalance > 0 ? 'warning' : 'muted'}
            icon={<Hourglass />}
          />
        </div>
        <div className="animate-fade-in-up motion-reduce:animate-none [animation-delay:210ms]">
          <StatCard
            label="Avg bill"
            value={inr(data.bills.length > 0 ? Math.round(totalAmount / data.bills.length) : 0)}
            hint={fmtIST(from, 'date') + ' → ' + fmtIST(to, 'date')}
            icon={<Banknote />}
          />
        </div>
      </div>

      <BalancesBillsTable
        bills={data.bills.map((b) => ({
          billId: b.billId,
          billNumber: b.billNumber,
          billDate: b.billDate,
          patientName: b.patientName,
          patientId: b.patientId,
          doctorName: b.doctorName,
          customerName: b.customerName,
          paymentType: b.paymentType,
          mobile: b.mobile,
          sids: b.sids,
          age: b.age,
          ageType: b.ageType,
          amount: b.amount,
          discount: b.discount,
          amountPaid: b.amountPaid,
          balance: b.balance,
        }))}
        unpinnedIds={unpinnedIds}
        mccId={mccId}
        from={from}
        to={to}
        mine={mine}
      />
      </div>{/* end screen view */}
    </div>
  );
}
