import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope, ownCentreIds } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { fetchMrpOnly } from '@/db/read/teloUsers';
import { getCart } from '@/db/cartStore';
import { RegisterForm } from '@/components/register/register-form';
import { PageHeader } from '@/components/ui/page-header';

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
    <div className="stagger space-y-4">
      <PageHeader
        eyebrow="B2B channel"
        title="B2B order"
        description="Patient bill is at MRP; client rate & margin shown for reference"
        actions={
          <Link
            href="/orders/b2b"
            className="rounded-lg border border-foreground/10 bg-card/60 px-3 py-1.5 text-sm text-muted-foreground shadow-sm transition-colors hover:border-primary/30 hover:text-foreground"
          >
            ← Worklist
          </Link>
        }
      />
      <RegisterForm units={units} initialItems={cart.items} mode="b2b" />
    </div>
  );
}
