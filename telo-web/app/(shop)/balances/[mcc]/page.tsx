import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getLedgerForMcc, getBillsForExport } from '@/actions/ledger.actions';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getMccInvoiceConfig } from '@/db/read/invoiceConfig';
import { getReceiptsInPeriod } from '@/db/read/receipts';
import { getMccScope } from '@/auth/scope';
import { fmtIST, todayIST, addDaysIST, firstOfMonthIST } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { getUnpinnedBillIds } from '@/db/pins';
import { AccountsReport } from '@/components/balances/accounts-report';
import { MccBalanceFilters } from '@/components/balances/mcc-balance-filters';
import { BalancesBillsTable } from '@/components/balances/balances-bills-table';
import { BalanceViewTabs } from '@/components/balances/balance-view-tabs';
import { PrintReportButton } from '@/components/balances/print-report-button';
import { ExportBillsButton } from '@/components/balances/export-bills-button';
import { AutoPrint } from '@/components/balances/auto-print';

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
  searchParams: Promise<{
    from?: string;
    to?: string;
    mine?: string;
    q?: string;
    page?: string;
    /** ?print=1 renders the FULL statement (all bills, unpaginated). The
     *  screen view stays paginated; only this mode loads everything. */
    print?: string;
  }>;
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
  // Server-side search + paging: both live in the URL alongside from/to/mine,
  // so a filtered page is shareable and the browser Back button works.
  const q = (sp.q ?? '').trim();
  const pageParam = Number(sp.page);
  const pageNo = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const printMode = sp.print === '1';

  // Receipts query is scoped to this MCC only — needs the user's mcc scope
  // to defend against URL-typing, so we fetch scope first then receipts in
  // parallel with the other reads.
  const scope = await getMccScope(user.uid);
  const [data, mccs, invoiceConfig, receipts] = await Promise.all([
    getLedgerForMcc(mccId, { from, to, mine, q, page: pageNo }),
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

  /** Same URL, different page — every other filter is preserved. */
  const pageHref = (n: number) => {
    const params = new URLSearchParams({ from, to });
    if (mine) params.set('mine', '1');
    if (q) params.set('q', q);
    if (n > 1) params.set('page', String(n));
    return `/balances/${mccId}?${params.toString()}`;
  };

  // Negative-balance bills are pinned to the top by default; load this user's
  // unpin exceptions so the client table can render the right pin state. Only
  // negative bills are pinnable, so the lookup set is naturally small.
  const negativeBillIds = data.bills
    .filter((b) => b.balance < 0)
    .map((b) => b.billId);
  const unpinnedIds = await getUnpinnedBillIds(user.uid, negativeBillIds);

  // ── Summary aggregates ─────────────────────────────────────────────────
  // Bill-date-keyed (what was billed in the window). These come from the SQL
  // totals, NOT from `data.bills` — that array is now a single page, so
  // summing it would under-report the period the moment paging kicks in.
  const totalAmount = data.totals.amount;
  const pendingBills = data.totals.pendingCount;
  // Receipt-date-keyed (what was actually collected in the window):
  // see db/read/receipts.ts — payments recorded today against any bill
  // roll up here, never into prior days' totals.
  const totalPaid  = receipts.collected;
  const cashPaid   = receipts.cashCollected;
  const otherPaid  = receipts.otherCollected;
  const cashCount  = receipts.cashCount;
  const otherCount = receipts.otherCount;

  // Print mode: load the WHOLE period so the statement is complete. A printed
  // account statement must never be a page of it — the screen view is paged,
  // this is not. Rendered on its own so the heavy table only exists when the
  // operator actually asked to print.
  if (printMode) {
    const full = await getBillsForExport(mccId, { from, to, mine, q });
    return (
      <div>
        <AutoPrint />
        <AccountsReport
          mccName={mccMeta?.name ?? null}
          mccCode={mccMeta?.code ?? null}
          invoiceConfig={invoiceConfig}
          from={from}
          to={to}
          bills={full.bills}
          receiptsByBill={full.receiptsByBill}
          totalBalance={data.totalBalance}
          receipts={receipts}
        />
      </div>
    );
  }

  return (
    <div>

      {/* ── Screen view: interactive ledger ────────────────────────── */}
      <div className="space-y-4 print:hidden">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {mccMeta?.name ?? `MCC ${mccId}`}{' '}
            <span className="font-mono text-base text-muted-foreground">
              {mccMeta?.code ?? mccId}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.totals.count.toLocaleString('en-IN')} Telo bill
            {data.totals.count === 1 ? '' : 's'}
            {mine ? ' (yours)' : ''}
            {q ? ` matching “${q}”` : ''} · {inr(data.totalBalance)}{' '}
            balance · {fmtIST(from, 'date')} → {fmtIST(to, 'date')}
            {data.totalPages > 1 && (
              <> · page {data.page} of {data.totalPages}</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showBackLink && (
            <BalanceViewTabs mccId={mccId} from={from} to={to} active="bills" />
          )}
          <ExportBillsButton
            mccId={mccId}
            from={from}
            to={to}
            mine={mine}
            q={q}
            rowCount={data.totals.count}
            fileName={`${mccMeta?.code ?? mccId}_accounts_${from}_${to}.xlsx`}
          />
          <PrintReportButton
            rowCount={data.totals.count}
            printHref={`${pageHref(1)}&print=1`}
          />
          {showBackLink && (
            <Link href={backHref} className="text-sm underline">
              ← Accounts summary
            </Link>
          )}
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
        <StatCard
          label="Total billed"
          value={inr(totalAmount)}
          // Period count, NOT data.bills.length — that's one page, so the card
          // read "200 bills" beside a ₹53L period total.
          hint={`${data.totals.count.toLocaleString('en-IN')} bill${data.totals.count === 1 ? '' : 's'}`}
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
          // Period total ÷ period count. Dividing by the page length made the
          // average ~31× too high on a 31-page account.
          value={inr(data.totals.count > 0 ? Math.round(totalAmount / data.totals.count) : 0)}
          hint={fmtIST(from, 'date') + ' → ' + fmtIST(to, 'date')}
        />
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
        q={q}
        matchCount={data.totals.count}
      />

      {/* Pager — plain links so paging survives a reload/share and needs no
          client state. Only rendered when the period actually spans pages. */}
      {data.totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Showing{' '}
            {((data.page - 1) * data.pageSize + 1).toLocaleString('en-IN')}–
            {Math.min(
              data.page * data.pageSize,
              data.totals.count,
            ).toLocaleString('en-IN')}{' '}
            of {data.totals.count.toLocaleString('en-IN')}
          </span>
          <span className="flex items-center gap-2">
            <PagerLink
              disabled={data.page <= 1}
              href={pageHref(data.page - 1)}
              label="‹ Prev"
            />
            <span className="tabular-nums text-muted-foreground">
              {data.page} / {data.totalPages}
            </span>
            <PagerLink
              disabled={data.page >= data.totalPages}
              href={pageHref(data.page + 1)}
              label="Next ›"
            />
          </span>
        </div>
      )}
      </div>{/* end screen view */}
    </div>
  );
}

/** Pager control — a link when navigable, an inert span at the ends. */
function PagerLink({
  href,
  label,
  disabled,
}: {
  href: string;
  label: string;
  disabled: boolean;
}) {
  const base = 'rounded-md border border-foreground/10 px-2.5 py-1 text-xs';
  if (disabled) {
    return (
      <span className={cn(base, 'cursor-not-allowed opacity-40')}>{label}</span>
    );
  }
  return (
    <Link href={href} className={cn(base, 'hover:bg-foreground/5')}>
      {label}
    </Link>
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
    <div className="rounded-xl border border-foreground/5 bg-card p-4">
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
        <div className="mt-3 space-y-1 border-t border-foreground/5 pt-2">
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
