import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getRolesHubData } from '@/actions/roles.actions';
import { RolesHub } from '@/components/admin/roles-hub';

export const dynamic = 'force-dynamic';

export default async function AdminRolesPage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'user:manage')) redirect('/dashboard');

  const data = await getRolesHubData();

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Roles &amp; permissions
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage LIS user levels (Security Master menus + action bits) and
            Telo roles (capability grants) in one place. Per-user assignment
            stays on{' '}
            <a href="/admin/users" className="underline hover:text-foreground">
              User accounts
            </a>
            .
          </p>
        </div>
        <a
          href="/admin/users"
          className="shrink-0 text-sm text-muted-foreground underline hover:text-foreground"
        >
          ← User accounts
        </a>
      </div>
      <RolesHub initial={data} />
    </div>
  );
}
