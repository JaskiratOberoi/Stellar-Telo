import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getAdminOverview } from '@/actions/admin.actions';
import { UserManagement } from '@/components/admin/user-management';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'user:manage')) redirect('/dashboard');

  const overview = await getAdminOverview();

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">User accounts</h1>
          <p className="text-sm text-muted-foreground">
            Telo users sign in with their LIS credentials. Users without an
            explicit Telo role get one derived from their LIS user type (shown
            as <em className="not-italic font-medium">(from LIS)</em>); pick a
            role on a row to override. The LIS user type is independent — it
            governs LIS-side access only.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <a
            href="/admin/interpretations"
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Profile interpretations →
          </a>
          <a
            href="/admin/invoice"
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Invoice settings →
          </a>
        </div>
      </div>
      <UserManagement initial={overview} currentUid={user.uid} />
    </div>
  );
}
