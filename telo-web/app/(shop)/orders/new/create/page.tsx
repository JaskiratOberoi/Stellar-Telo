import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope, ownCentreIds } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getCart } from '@/db/cartStore';
import { RegisterForm } from '@/components/register/register-form';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

export default async function NewOrderCreatePage() {
  const user = await requireSession();
  if (
    !hasCapability(user.caps, 'order:create') ||
    !hasCapability(user.caps, 'order:b2c')
  )
    redirect('/dashboard');

  const scope = await getMccScope(user.uid);
  const [units, cart] = await Promise.all([
    fetchScopedMccUnits(scope, ownCentreIds(user)),
    getCart(user.uid),
  ]);

  return (
    <div>
      <PageHeader
        title="New order"
        description="Patient, tests & payment — Sample IDs optional"
        backHref="/orders/new"
        backLabel="Worklist"
        className="mb-4"
      />
      <RegisterForm units={units} initialItems={cart.items} />
    </div>
  );
}
