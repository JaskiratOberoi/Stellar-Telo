import type { Cart, PricedCart, PricedLine } from './cart.types';
import type { ResolveItem, ResolvedRate } from '@/db/sp/resolveRate';

/**
 * Pure cart-pricing assembly. Takes a BATCH rate resolver (injected — no IO
 * here) and produces the priced cart in a single round-trip. Total excludes
 * lines whose rate is unresolved; `hasUnresolved` flags that so checkout can
 * block.
 *
 * Note: the resolver is batch-only on purpose. The old per-line variant was
 * the single largest perf bug in the cart/checkout/register paths — N items
 * meant N sequential round-trips to a SQL Server in India. Keeping the
 * signature collection-shaped here ensures no caller can re-introduce the
 * fan-out.
 */
export async function priceCart(
  cart: Cart,
  resolve: (items: ResolveItem[]) => Promise<ResolvedRate[]>,
): Promise<PricedCart> {
  if (cart.mccCode == null) {
    return {
      mccCode: null,
      lines: cart.items.map((i) => ({ ...i, rate: null, source: 'none' })),
      total: 0,
      hasUnresolved: cart.items.length > 0,
    };
  }

  const rates = await resolve(
    cart.items.map((item) =>
      item.kind === 'profile'
        ? { profileCode: item.id }
        : { testMasterId: item.id },
    ),
  );

  const lines: PricedLine[] = cart.items.map((item, idx) => {
    const rr = rates[idx];
    return { ...item, rate: rr?.rate ?? null, source: rr?.source ?? 'none' };
  });

  const total = lines.reduce((s, l) => s + (l.rate ?? 0), 0);
  const hasUnresolved = lines.some((l) => l.rate == null);
  return { mccCode: cart.mccCode, lines, total, hasUnresolved };
}
