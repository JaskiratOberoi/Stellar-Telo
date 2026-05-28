import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { loadCatalog } from '@/db/read/catalog';
import { toPublicCatalogItem } from '@/domain/catalog/catalog.types';
import { CatalogBrowser } from '@/components/catalog/catalog-browser';

export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const user = await requireSession();
  const canOrder = hasCapability(user.caps, 'order:create');

  const all = await loadCatalog();
  // Strip costCt before the rows ever cross the server/client boundary.
  // CatalogBrowser does the rest of the work (filter + paginate) entirely
  // in the browser, so typing into the search box no longer triggers an
  // RSC round-trip per keystroke.
  const publicItems = all.map(toPublicCatalogItem);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Catalog</h1>
        <p className="text-muted-foreground">
          {all.length.toLocaleString()} active tests &amp; profiles · MRP pricing
        </p>
      </div>
      <CatalogBrowser items={publicItems} canOrder={canOrder} />
    </div>
  );
}
