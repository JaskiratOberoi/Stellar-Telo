import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope, ownCentreIds } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getCart } from '@/db/cartStore';
import { RegisterForm } from '@/components/register/register-form';

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
    <div className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="text-xl font-bold tracking-tight">New order</h1>
          <p className="text-sm text-muted-foreground">
            Patient, tests &amp; payment — Sample IDs optional
          </p>
        </div>
        <Link href="/orders/new" className="shrink-0 text-sm underline">
          ← Worklist
        </Link>
      </div>
      <RegisterForm units={units} initialItems={cart.items} />
    </div>
  );
}
