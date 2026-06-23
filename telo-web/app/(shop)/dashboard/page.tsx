import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability, lisUsertypeToTeloRole } from '@/auth/rbac';
import { getDashboardStats } from '@/actions/stats.actions';
import { DashboardLive } from '@/components/dashboard/dashboard-live';
import { getMccScope } from '@/auth/scope';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireSession();
  // B2B clients are greeted on the animated payment home instead of the revenue
  // dashboard. The login flow points everyone at /dashboard; bounce clients so
  // any deep-link (URL bar, bookmark, brand mark) lands them home too. Use the
  // EFFECTIVE role — most clients are implicit (LIS-derived), so teloRole is
  // null for them.
  if ((user.teloRole ?? lisUsertypeToTeloRole(user.usertypeId)) === 'client')
    redirect('/home');
  // Technicians don't see revenue KPIs — their home is the New Order
  // worklist. The login flow points everyone at /dashboard; we bounce them
  // here so any deep-link (URL bar, bookmark, "Back to home") also works.
  if (!hasCapability(user.caps, 'dashboard:view')) redirect('/orders/new');

  const [stats, scope] = await Promise.all([
    getDashboardStats(),
    getMccScope(user.uid),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Welcome, {user.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            <code>{user.username}</code>
            {user.usertypeName ? ` · ${user.usertypeName}` : ''} ·{' '}
            {scope.length.toLocaleString('en-IN')} collection centre
            {scope.length === 1 ? '' : 's'} in scope
          </p>
        </div>
      </div>

      <DashboardLive initial={stats} />
    </div>
  );
}
