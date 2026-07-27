import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getPendingAccessions } from '@/actions/orders.actions';
import { PendingAccessionsList } from '@/components/orders/pending-accessions-list';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

export default async function NewOrderWorklistPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requireSession();
  // B2C worklist — anyone with the B2C channel (Technician included). B2B-only
  // roles (b2b_billing) are redirected away.
  if (!hasCapability(user.caps, 'order:b2c')) redirect('/dashboard');

  const feed = await getPendingAccessions();
  const canCreate = hasCapability(user.caps, 'order:create');
  const sp = await searchParams;
  const createdId = sp.created ? Number(sp.created) : NaN;
  const highlightBillId = Number.isInteger(createdId) ? createdId : undefined;

  return (
    <div className="stagger space-y-4">
      <PageHeader
        eyebrow="B2C channel"
        title="New order"
        description={
          canCreate
            ? 'Registered orders still awaiting Sample IDs. Open one to accession its barcodes, or use the New Order button to register a new order.'
            : 'Registered orders still awaiting Sample IDs. Open one to accession its barcodes.'
        }
      />
      <PendingAccessionsList
        initial={feed}
        highlightBillId={highlightBillId}
      />
    </div>
  );
}
