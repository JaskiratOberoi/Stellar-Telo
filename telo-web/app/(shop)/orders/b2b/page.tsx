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
 * B2B Orders — same registration flow as New Order, but the cart shows the
 * client's cost (rate-list price) and their margin, and the bill is charged at
 * MRP (the patient price). Hidden from MRP-only accounts (e.g. MDCARE); the
 * guard below also closes the door to URL-typing.
 */
export default async function B2bOrderPage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'order:create')) redirect('/dashboard');
  if (await fetchMrpOnly(user.uid)) redirect('/dashboard');

  const scope = await getMccScope(user.uid);
  const [units, cart] = await Promise.all([
    fetchScopedMccUnits(scope, ownCentreIds(user)),
    getCart(user.uid),
  ]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight">B2B order</h1>
          <p className="text-sm text-muted-foreground">
            Patient bill is at MRP; client rate &amp; margin shown for reference
          </p>
        </div>
        <Link href="/orders/new" className="text-sm underline">
          ← Worklist
        </Link>
      </div>
      <RegisterForm units={units} initialItems={cart.items} mode="b2b" />
    </div>
  );
}
