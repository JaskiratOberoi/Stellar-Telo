import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope, ownCentreIds } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { loadCatalogPricedForMcc } from '@/db/read/catalog';
import { getCart } from '@/db/cartStore';
import { CatalogBrowser } from '@/components/catalog/catalog-browser';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ mcc?: string }>;
}) {
  const user = await requireSession();
  const canOrder = hasCapability(user.caps, 'order:create');

  // Price the catalog against the logged-in account's client (MCC) rate list,
  // not the global MRP master. Default to the account's first in-scope client;
  // multi-client users can switch via the ?mcc= selector in CatalogBrowser.
  const scope = await getMccScope(user.uid);
  const units = await fetchScopedMccUnits(scope, ownCentreIds(user));

  const sp = await searchParams;
  const requested = sp.mcc && /^\d+$/.test(sp.mcc) ? Number(sp.mcc) : null;
  const selectedMccId =
    requested != null && units.some((u) => u.id === requested)
      ? requested
      : (units[0]?.id ?? null);

  const selectedUnit = units.find((u) => u.id === selectedMccId) ?? null;

  // loadCatalogPricedForMcc returns the cost-free public shape with rate added,
  // so nothing sensitive crosses the server/client boundary. Filtering +
  // pagination stay entirely in the browser (no per-keystroke RSC round-trip).
  const items = await loadCatalogPricedForMcc(selectedMccId);

  // Which catalog items are already in this user's order cart — keyed
  // `${kind}-${id}` — so each row can render Add vs. Added/Remove correctly on
  // load (and after a refresh), not just within the current session.
  const inCartKeys = canOrder
    ? (await getCart(user.uid)).items.map((i) => `${i.kind}-${i.id}`)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catalog"
        description={
          <>
            {items.length.toLocaleString('en-IN')} active tests &amp; profiles ·{' '}
            {selectedUnit
              ? `${selectedUnit.name ?? selectedUnit.code} (${selectedUnit.code}) rates`
              : 'MRP pricing'}
          </>
        }
        className="mb-0"
      />
      <CatalogBrowser
        items={items}
        canOrder={canOrder}
        units={units}
        selectedMccId={selectedMccId}
        inCartKeys={inCartKeys}
      />
    </div>
  );
}
