import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { fetchScopedMccUnits, fetchScopedClients } from '@/db/read/mccUnits';
import {
  getMccAccountSummary,
  listMccAccountDetail,
  type AccountTypeFilter,
} from '@/db/read/mccLedger';
import { StatCard } from '@/components/ui/stat-card';
import { ClientAccountFilters } from '@/components/client-accounts/client-account-filters';
import { AccountDetailTable } from '@/components/client-accounts/account-detail-table';
import { RecordClientPayment } from '@/components/client-accounts/record-client-payment';
import { fmtIST, todayIST, addDaysIST, firstOfMonthIST } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const firstOfWeek = (): string => {
  const t = todayIST();
  const [y, m, d] = t.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysIST(t, diff);
};
const firstOfYear = (): string => `${todayIST().slice(0, 4)}-01-01`;

export default async function ClientAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ mcc: string }>;
  searchParams: Promise<{ from?: string; to?: string; type?: string }>;
}) {
  const { mcc } = await params;
  const mccId = Number(mcc);
  if (!Number.isInteger(mccId)) notFound();

  const user = await requireSession();
  if (!hasCapability(user.caps, 'account:view')) redirect('/dashboard');
  // Recording manual payments into the shared LIS wallet is Super-Admin-only.
  const canManagePayments = hasCapability(user.caps, 'account:manage');

  const sp = await searchParams;
  const from =
    sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : firstOfMonthIST();
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : todayIST();
  const type: AccountTypeFilter | null =
    sp.type === 'payment' || sp.type === 'credit' || sp.type === 'debit'
      ? sp.type
      : null;

  const scope = await getMccScope(user.uid);
  if (scope.length > 0 && scope.length <= 1000 && !scope.includes(mccId)) {
    redirect('/client-accounts');
  }

  // Scoped users (≤1000) get an inline client switcher with Business-Unit
  // narrowing; unrestricted admins use search (no big dropdown). Multi-MCC only.
  const scopedClients =
    scope.length > 1 && scope.length <= 1000
      ? await fetchScopedClients(scope)
      : undefined;

  const [summary, detail, mccs] = await Promise.all([
    getMccAccountSummary(mccId, { from, to }),
    listMccAccountDetail(mccId, { from, to }, type),
    fetchScopedMccUnits([mccId], [mccId]),
  ]);
  const mccMeta = mccs[0];
  const showBackLink = scope.length !== 1;

  const td = todayIST();
  const periods = [
    { label: 'Today', from: td, to: td },
    { label: 'This week', from: firstOfWeek(), to: td },
    { label: 'This month', from: firstOfMonthIST(), to: td },
    { label: 'This year', from: firstOfYear(), to: td },
  ];
  const activePeriod = periods.find((p) => p.from === from && p.to === to);

  const onlineCount = detail.filter((d) => d.isOnline).length;

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
            Franchise wallet · {detail.length} transaction
            {detail.length === 1 ? '' : 's'}
            {type ? ` (${type})` : ''} · {fmtIST(from, 'date')} →{' '}
            {fmtIST(to, 'date')}
          </p>
        </div>
        {showBackLink && (
          <Link href="/client-accounts" className="text-sm underline">
            ← All clients
          </Link>
        )}
      </div>

      {canManagePayments && <RecordClientPayment mccId={mccId} today={td} />}

      <ClientAccountFilters
        mccId={mccId}
        from={from}
        to={to}
        type={type}
        periods={periods}
        activeLabel={activePeriod?.label ?? null}
        maxDate={td}
        clients={scopedClients}
        showClientSwitcher={scope.length !== 1}
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Current Balance"
          value={inr(summary.currentBalance)}
          hint={
            summary.currentBalance < 0
              ? 'Outstanding (owed to lab)'
              : 'In credit'
          }
          variant={summary.currentBalance < 0 ? 'warning' : 'positive'}
        />
        <StatCard
          label="Total Deposited"
          value={inr(summary.totalDeposited)}
          hint="All-time payments"
        />
        <StatCard
          label="Total Test Charges"
          value={inr(summary.totalTestCharges)}
          hint="All-time billed tests"
        />
        <StatCard
          label="In selected period"
          value={inr(summary.periodPayments)}
          hint="Payments received"
          variant="positive"
          breakdown={[
            { label: 'Test charges', value: inr(summary.periodTestCharges) },
            ...(onlineCount > 0
              ? [
                  {
                    label: 'Online payments',
                    value: String(onlineCount),
                    sub: 'auto-posted',
                  },
                ]
              : []),
          ]}
        />
      </div>

      <AccountDetailTable rows={detail} />

      <p className="text-[11px] italic text-muted-foreground">
        Read-only mirror of the LIS client account. Total Deposited is the sum of
        payment rows (excluding inactive), not the stored running total. Online
        rows are auto-posted by the payment portal — Cheque/Txn No is the gateway
        order id and Reason carries the UPI/bank reference.
      </p>
    </div>
  );
}
