import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getRateTypeName, getRateListRates } from '@/db/read/rateLists';
import { RateListEditor } from '@/components/rate-lists/rate-list-editor';

export const dynamic = 'force-dynamic';

export default async function RateListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rateTypeId = Number(id);
  if (!Number.isInteger(rateTypeId)) notFound();

  const user = await requireSession();
  if (!hasCapability(user.caps, 'rate:view')) redirect('/dashboard');

  const [name, rows] = await Promise.all([
    getRateTypeName(rateTypeId),
    getRateListRates(rateTypeId),
  ]);
  if (name == null) notFound();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{name}</h1>
          <p className="text-sm text-muted-foreground">
            Rate list #{rateTypeId}
          </p>
        </div>
        <Link href="/rate-lists" className="text-sm underline">
          ← All rate lists
        </Link>
      </div>
      <RateListEditor
        rateTypeId={rateTypeId}
        rows={rows}
        canManage={hasCapability(user.caps, 'rate:manage')}
      />
    </div>
  );
}
