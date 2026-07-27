import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { fetchMrpOnly } from '@/db/read/teloUsers';
import {
  getPendingAccessions,
  getPendingRegistrations,
} from '@/actions/orders.actions';
import { PendingAccessionsList } from '@/components/orders/pending-accessions-list';
import { PendingRegistrationsList } from '@/components/orders/pending-registrations-list';

export const dynamic = 'force-dynamic';

/**
 * B2B Orders worklist — mirrors the New Order worklist but lists ONLY B2B
 * orders (tagged in telo_order_kind; billed at MRP). Use the New B2B Order
 * button to register one. Hidden from MRP-only accounts (e.g. MDCARE); the
 * guard below also closes the door to URL-typing.
 */
export default async function B2bOrderWorklistPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requireSession();
  // B2B worklist — B2C-only roles (b2c_billing) are redirected away.
  if (!hasCapability(user.caps, 'order:b2b')) redirect('/dashboard');
  if (await fetchMrpOnly(user.uid)) redirect('/dashboard');

  const [feed, registrationFeed] = await Promise.all([
    getPendingAccessions('b2b'),
    getPendingRegistrations('b2b'),
  ]);
  const canCreate = hasCapability(user.caps, 'order:create');
  const sp = await searchParams;
  const createdId = sp.created ? Number(sp.created) : NaN;
  const highlightBillId = Number.isInteger(createdId) ? createdId : undefined;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Patient Orders</h1>
          <p className="text-sm text-muted-foreground">
            {canCreate
              ? 'Registered B2B orders still awaiting Sample IDs. Open one to accession its barcodes, or use the New B2B Order button to register one. The patient bill is at MRP; the client rate & margin are shown while registering.'
              : 'Registered B2B orders still awaiting Sample IDs. Open one to accession its barcodes.'}
          </p>
        </div>
        <PendingAccessionsList
          initial={feed}
          highlightBillId={highlightBillId}
          variant="b2b"
        />
      </div>

      {/* Second stage of the same pipeline: the SID exists, but the LIS has not
          received it yet — so it is not on the worksheet. */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Pending accessioning
          </h2>
          <p className="text-sm text-muted-foreground">
            Sample IDs already allotted but not yet registered in the LIS (still
            “Sample Sent”). These do not appear on the worksheet until the lab
            receives the sample.
          </p>
        </div>
        <PendingRegistrationsList initial={registrationFeed} variant="b2b" />
      </div>
    </div>
  );
}
