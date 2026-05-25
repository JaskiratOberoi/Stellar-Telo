import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { listRateTypes } from '@/db/read/rateLists';
import { RateListsBrowser } from '@/components/rate-lists/rate-lists-browser';

export const dynamic = 'force-dynamic';

export default async function RateListsPage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'rate:view')) redirect('/dashboard');
  const lists = await listRateTypes();

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Rate lists</h1>
        <p className="text-sm text-muted-foreground">
          {lists.length} rate lists · click one to view/edit its test prices
        </p>
      </div>
      <RateListsBrowser
        lists={lists}
        canManage={hasCapability(user.caps, 'rate:manage')}
      />
    </div>
  );
}
