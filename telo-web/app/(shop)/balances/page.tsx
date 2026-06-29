import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import {
  getAccountsSummary,
  type PaymentModeFilter,
} from '@/actions/ledger.actions';
import { AccountsSummaryView } from '@/components/balances/balances-summary';
import { todayIST, firstOfMonthIST } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const today = (): string => todayIST();
const firstOfMonth = (): string => firstOfMonthIST();

const PAY_MODES: ReadonlySet<PaymentModeFilter> = new Set([
  'all',
  'cash',
  'credit',
]);

export default async function BalancesPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    mcc?: string;
    pay?: string;
  }>;
}) {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'balance:view')) redirect('/dashboard');

  const sp = await searchParams;
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : firstOfMonth();
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today();
  const mccId = sp.mcc && /^\d+$/.test(sp.mcc) ? Number(sp.mcc) : null;
  const paymentMode: PaymentModeFilter = PAY_MODES.has(sp.pay as PaymentModeFilter)
    ? (sp.pay as PaymentModeFilter)
    : 'all';

  const scope = await getMccScope(user.uid);

  // Single-MCC users (typical for a client account, e.g. medicare_test → ABC)
  // skip the one-row rollup and land straight on their MCC's bill list. Date
  // range carries over.
  if (scope.length === 1) {
    redirect(`/balances/${scope[0]}?from=${from}&to=${to}`);
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Accounts summary</h1>
        <p className="text-sm text-muted-foreground">
          Telo-originated bills only, rolled up per Client code. Click a row to
          see the bills driving its totals.
        </p>
      </div>
      {/* Suspense so the heading + breadcrumb paint immediately while the
       *  scope-wide summary (the slow Noble query) streams in. The fallback
       *  reserves table height so the layout doesn't jump on stream-in.   */}
      <Suspense
        fallback={
          <div className="rounded-lg border border-foreground/5 bg-card/50 p-6 text-sm text-muted-foreground">
            Loading accounts…
          </div>
        }
      >
        <AccountsSummaryLoader
          from={from}
          to={to}
          mccId={mccId}
          paymentMode={paymentMode}
          scope={scope}
        />
      </Suspense>
    </div>
  );
}

/**
 * Streamed child so the page shell can render before the rollup query and
 * the scoped-MCC fetch complete. Pure async server component — runs once on
 * the server, ships HTML to the client.
 */
async function AccountsSummaryLoader({
  from,
  to,
  mccId,
  paymentMode,
  scope,
}: {
  from: string;
  to: string;
  mccId: number | null;
  paymentMode: PaymentModeFilter;
  scope: number[];
}) {
  const [summary, mccs] = await Promise.all([
    getAccountsSummary({ from, to, mccId, paymentMode }),
    // Unrestricted users (>1000 MCCs) skip the dropdown — too long to pick from;
    // they use the search/balance ranking instead.
    scope.length > 0 && scope.length <= 1000
      ? fetchScopedMccUnits(scope)
      : Promise.resolve([]),
  ]);
  return <AccountsSummaryView initial={summary} mccs={mccs} />;
}
