import { redirect } from 'next/navigation';
import { BookOpenText, ReceiptText } from 'lucide-react';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getAdminOverview } from '@/actions/admin.actions';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { UserManagement } from '@/components/admin/user-management';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'user:manage')) redirect('/dashboard');

  const overview = await getAdminOverview();

  return (
    <div className="space-y-3">
      <PageHeader
        title="User accounts"
        description={
          <>
            Telo users sign in with their LIS credentials. Users without an
            explicit Telo role get one derived from their LIS user type (shown
            as <em className="not-italic font-medium">(from LIS)</em>); pick a
            role on a row to override. The LIS user type is independent — it
            governs LIS-side access only.
          </>
        }
        className="mb-0"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href="/admin/interpretations">
                <BookOpenText className="h-3.5 w-3.5" aria-hidden />
                Profile interpretations
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="/admin/invoice">
                <ReceiptText className="h-3.5 w-3.5" aria-hidden />
                Invoice settings
              </a>
            </Button>
          </>
        }
      />
      <UserManagement initial={overview} currentUid={user.uid} />
    </div>
  );
}
