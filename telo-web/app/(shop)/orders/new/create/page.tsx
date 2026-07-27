import Link from 'next/link';
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
    <div className="stagger space-y-4">
      <PageHeader
        eyebrow="B2C channel"
        title="New order"
        description="Patient, tests & payment — Sample IDs optional"
        actions={
          <Link
            href="/orders/new"
            className="rounded-lg border border-foreground/10 bg-card/60 px-3 py-1.5 text-sm text-muted-foreground shadow-sm transition-colors hover:border-primary/30 hover:text-foreground"
          >
            ← Worklist
          </Link>
        }
      />
      <RegisterForm units={units} initialItems={cart.items} />
    </div>
  );
}
