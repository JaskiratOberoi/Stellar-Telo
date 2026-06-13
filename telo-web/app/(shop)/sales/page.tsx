import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { ClientPicker } from '@/components/mcc/client-picker';
import { todayIST } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function SalesIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'sales:view')) redirect('/dashboard');

  const sp = await searchParams;
  // Sales defaults to today (matches the LIS Sales Data screen).
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : todayIST();
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : todayIST();

  const scope = await getMccScope(user.uid);
  if (scope.length === 1) {
    redirect(`/sales/${scope[0]}?from=${from}&to=${to}`);
  }

  const options =
    scope.length > 0 && scope.length <= 1000
      ? await fetchScopedMccUnits(scope)
      : undefined;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Sales Data</h1>
        <p className="text-sm text-muted-foreground">
          Itemised billable test sales per client over a date range. Pick a
          client to view its sales.
        </p>
      </div>
      <ClientPicker basePath="/sales" from={from} to={to} options={options} />
    </div>
  );
}
