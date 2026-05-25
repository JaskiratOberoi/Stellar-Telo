import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getPendingAccessions } from '@/actions/orders.actions';
import { PendingAccessionsList } from '@/components/orders/pending-accessions-list';

export const dynamic = 'force-dynamic';

export default async function NewOrderWorklistPage() {
  const user = await requireSession();
  // Worklist visible to anyone who can view orders (Technician included).
  if (!hasCapability(user.caps, 'order:view')) redirect('/dashboard');

  const feed = await getPendingAccessions();
  const canCreate = hasCapability(user.caps, 'order:create');

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">New order</h1>
        <p className="text-sm text-muted-foreground">
          {canCreate
            ? 'Registered orders still awaiting Sample IDs. Open one to accession its barcodes, or use the + button to register a new order.'
            : 'Registered orders still awaiting Sample IDs. Open one to accession its barcodes.'}
        </p>
      </div>
      <PendingAccessionsList initial={feed} canCreate={canCreate} />
    </div>
  );
}
