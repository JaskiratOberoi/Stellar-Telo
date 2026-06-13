import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { listSalesForMcc, getSalesTotals } from '@/db/read/salesData';
import { StatCard } from '@/components/ui/stat-card';
import { DateRangeFilters } from '@/components/mcc/date-range-filters';
import { SalesTable } from '@/components/sales/sales-table';
import { fmtIST, todayIST, addDaysIST, firstOfMonthIST } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const PAGE_SIZE = 100;

const firstOfWeek = (): string => {
  const t = todayIST();
  const [y, m, d] = t.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysIST(t, diff);
};

export default async function SalesMccPage({
  params,
  searchParams,
}: {
  params: Promise<{ mcc: string }>;
  searchParams: Promise<{ from?: string; to?: string; page?: string }>;
}) {
  const { mcc } = await params;
  const mccId = Number(mcc);
  if (!Number.isInteger(mccId)) notFound();

  const user = await requireSession();
  if (!hasCapability(user.caps, 'sales:view')) redirect('/dashboard');

  const sp = await searchParams;
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : todayIST();
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : todayIST();
  const page = sp.page && /^\d+$/.test(sp.page) ? Math.max(1, Number(sp.page)) : 1;

  const scope = await getMccScope(user.uid);
  if (scope.length > 0 && scope.length <= 1000 && !scope.includes(mccId)) {
    redirect('/sales');
  }

  const [totals, sales, mccs] = await Promise.all([
    getSalesTotals(mccId, { from, to }),
    listSalesForMcc(mccId, { from, to }, { page, pageSize: PAGE_SIZE }),
    fetchScopedMccUnits([mccId], [mccId]),
  ]);
  const mccMeta = mccs[0];
  const showBackLink = scope.length !== 1;

  const td = todayIST();
  const periods = [
    { label: 'Today', from: td, to: td },
    { label: 'Yesterday', from: addDaysIST(td, -1), to: addDaysIST(td, -1) },
    { label: 'This week', from: firstOfWeek(), to: td },
    { label: 'This month', from: firstOfMonthIST(), to: td },
  ];
  const activePeriod = periods.find((p) => p.from === from && p.to === to);

  const qs = `from=${from}&to=${to}`;

  // "Showing X–Y of N" for the footer (N = total sale lines across all pages).
  const rangeStart = sales.rows.length > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = sales.rows.length > 0 ? rangeStart + sales.rows.length - 1 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {mccMeta?.name ?? `Client ${mccId}`}{' '}
            <span className="font-mono text-base text-muted-foreground">
              {mccMeta?.code ?? mccId}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Sales · {fmtIST(from, 'date')} → {fmtIST(to, 'date')}
          </p>
        </div>
        {showBackLink && (
          <Link href="/sales" className="text-sm underline">
            ← All clients
          </Link>
        )}
      </div>

      <DateRangeFilters
        basePath="/sales"
        mccId={mccId}
        from={from}
        to={to}
        periods={periods}
        activeLabel={activePeriod?.label ?? null}
        maxDate={td}
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Sample(s)"
          value={totals.sampleCount.toLocaleString('en-IN')}
          hint="Distinct samples in period"
        />
        <StatCard
          label="Sale"
          value={inr(totals.saleAmount)}
          hint="Total billable test charges"
          variant="positive"
        />
      </div>

      <SalesTable rows={sales.rows} />

      <div className="flex items-center justify-between text-sm">
        <span className="text-xs text-muted-foreground">
          {sales.rows.length > 0
            ? `Page ${page} · Showing ${rangeStart.toLocaleString('en-IN')}–${rangeEnd.toLocaleString('en-IN')} of ${totals.lineCount.toLocaleString('en-IN')} result${totals.lineCount === 1 ? '' : 's'}`
            : 'No results'}
        </span>
        {(page > 1 || sales.hasMore) && (
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={`/sales/${mccId}?${qs}&page=${page - 1}`}
                className="rounded-md border border-white/10 px-3 py-1 hover:bg-white/5"
              >
                ← Prev
              </Link>
            ) : (
              <span className="rounded-md border border-white/5 px-3 py-1 text-muted-foreground opacity-50">
                ← Prev
              </span>
            )}
            {sales.hasMore ? (
              <Link
                href={`/sales/${mccId}?${qs}&page=${page + 1}`}
                className="rounded-md border border-white/10 px-3 py-1 hover:bg-white/5"
              >
                Next →
              </Link>
            ) : (
              <span className="rounded-md border border-white/5 px-3 py-1 text-muted-foreground opacity-50">
                Next →
              </span>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] italic text-muted-foreground">
        A sale line is a billable test (amount-checked) dated by its update time.
        Sample count is distinct samples (status &gt; 1) modified in the period —
        mirrors the LIS Sales Data screen.
      </p>
    </div>
  );
}
