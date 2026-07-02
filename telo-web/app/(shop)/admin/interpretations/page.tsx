import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getProfileInterpretationsOverview } from '@/actions/admin.actions';
import { PageHeader } from '@/components/ui/page-header';
import { InterpretationManagement } from '@/components/admin/interpretation-management';

export const dynamic = 'force-dynamic';

export default async function AdminInterpretationsPage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'user:manage')) redirect('/dashboard');

  const profiles = await getProfileInterpretationsOverview();

  return (
    <div className="space-y-3">
      <PageHeader
        title="Profile interpretations"
        description="Clinical-significance text shown once at the end of each profile on the report (the LIS only stores per-test notes). Edit a profile and Save; leave blank to show none."
        backHref="/admin/users"
        backLabel="User accounts"
        className="mb-0"
      />
      <InterpretationManagement initial={profiles} />
    </div>
  );
}
