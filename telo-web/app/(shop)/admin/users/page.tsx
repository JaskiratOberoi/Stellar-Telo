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
      <div>
        <h1 className="text-xl font-bold tracking-tight">User accounts</h1>
        <p className="text-sm text-muted-foreground">
          Telo users sign in with their LIS credentials. The role here controls
          what they see and do inside Telo. The LIS user type is independent —
          it governs LIS-side access only.
        </p>
      </div>
      <UserManagement initial={overview} currentUid={user.uid} />
    </div>
  );
}
