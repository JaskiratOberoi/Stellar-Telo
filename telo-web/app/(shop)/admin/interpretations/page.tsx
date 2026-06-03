import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getProfileInterpretationsOverview } from '@/actions/admin.actions';
import { InterpretationManagement } from '@/components/admin/interpretation-management';

export const dynamic = 'force-dynamic';

export default async function AdminInterpretationsPage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'user:manage')) redirect('/dashboard');

  const profiles = await getProfileInterpretationsOverview();

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Profile interpretations</h1>
          <p className="text-sm text-muted-foreground">
            Clinical-significance text shown once at the end of each profile on
            the report (the LIS only stores per-test notes). Edit a profile and
            Save; leave blank to show none.
          </p>
        </div>
        <a
          href="/admin/users"
          className="shrink-0 text-sm text-muted-foreground underline hover:text-foreground"
        >
          ← User accounts
        </a>
      </div>
      <InterpretationManagement initial={profiles} />
    </div>
  );
}
