import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope, ownCentreIds } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { fetchMrpOnly } from '@/db/read/teloUsers';
import { getCart } from '@/db/cartStore';
import { RegisterForm } from '@/components/register/register-form';

export const dynamic = 'force-dynamic';

/**
 * Register a new B2B order — same flow as New Order, but the cart shows the
 * client's cost (rate-list price) and their margin, and the bill is charged at
 * MRP (the patient price). Hidden from MRP-only accounts (e.g. MDCARE); the
 * guard below also closes the door to URL-typing.
 */
export default async function B2bOrderCreatePage() {
  const user = await requireSession();
  if (
    !hasCapability(user.caps, 'order:create') ||
    !hasCapability(user.caps, 'order:b2b')
  )
    redirect('/dashboard');
  if (await fetchMrpOnly(user.uid)) redirect('/dashboard');

  const scope = await getMccScope(user.uid);
  const [units, cart] = await Promise.all([
    fetchScopedMccUnits(scope, ownCentreIds(user)),
    getCart(user.uid),
  ]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="text-xl font-bold tracking-tight">B2B order</h1>
          <p className="text-sm text-muted-foreground">
            Patient bill is at MRP; client rate &amp; margin shown for reference
          </p>
        </div>
        <Link href="/orders/b2b" className="shrink-0 text-sm underline">
          ← Worklist
        </Link>
      </div>
      <RegisterForm units={units} initialItems={cart.items} mode="b2b" />
    </div>
  );
}
