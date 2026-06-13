import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { ClientPicker } from '@/components/mcc/client-picker';
import { todayIST, firstOfMonthIST } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function ClientAccountsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'account:view')) redirect('/dashboard');

  const sp = await searchParams;
  const from =
    sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : firstOfMonthIST();
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : todayIST();

  const scope = await getMccScope(user.uid);

  // Single-centre users (a client login) skip the picker — straight to their
  // own wallet. Mirrors the /balances single-MCC redirect.
  if (scope.length === 1) {
    redirect(`/client-accounts/${scope[0]}?from=${from}&to=${to}`);
  }

  // Scoped users (≤1000) get a dropdown; unrestricted admins get search.
  const options =
    scope.length > 0 && scope.length <= 1000
      ? await fetchScopedMccUnits(scope)
      : undefined;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Client Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Franchise wallet ledger — current balance, deposits, test charges and
          every payment/credit/debit. Pick a client to view its account.
        </p>
      </div>
      <ClientPicker basePath="/client-accounts" from={from} to={to} options={options} />
    </div>
  );
}
