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

export const dynamic = 'force-dynamic';

const today = (): string => new Date().toISOString().slice(0, 10);
const firstOfMonth = (): string => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

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
  const [summary, mccs] = await Promise.all([
    getAccountsSummary({ from, to, mccId, paymentMode }),
    // Unrestricted users (>1000 MCCs) skip the dropdown — too long to pick from;
    // they use the search/balance ranking instead.
    scope.length > 0 && scope.length <= 1000
      ? fetchScopedMccUnits(scope)
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Accounts summary</h1>
        <p className="text-sm text-muted-foreground">
          Telo-originated bills only, rolled up per Client code. Click a row to
          see the bills driving its totals.
        </p>
      </div>
      <AccountsSummaryView initial={summary} mccs={mccs} />
    </div>
  );
}
