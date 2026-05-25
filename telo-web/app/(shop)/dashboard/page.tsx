import { requireSession } from '@/auth/session';
import { getDashboardStats } from '@/actions/stats.actions';
import { DashboardLive } from '@/components/dashboard/dashboard-live';
import { getMccScope } from '@/auth/scope';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireSession();
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
