import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { RegisterForm } from '@/components/register/register-form';

export const dynamic = 'force-dynamic';

export default async function NewOrderCreatePage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'order:create')) redirect('/dashboard');

  const scope = await getMccScope(user.uid);
  const units = await fetchScopedMccUnits(scope);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight">New order</h1>
          <p className="text-sm text-muted-foreground">
            Patient, tests &amp; payment — Sample IDs optional
          </p>
        </div>
        <Link href="/orders/new" className="text-sm underline">
          ← Worklist
        </Link>
      </div>
      <RegisterForm units={units} />
    </div>
  );
}
