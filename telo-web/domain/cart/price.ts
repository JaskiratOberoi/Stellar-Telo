import type { Cart, PricedCart, PricedLine } from './cart.types';
import type { ResolvedRate } from '@/db/sp/resolveRate';

/**
 * Pure cart-pricing assembly. Takes a rate resolver (injected — no IO here)
 * and produces the priced cart. Total excludes lines whose rate is
 * unresolved; `hasUnresolved` flags that so checkout can block.
 */
export async function priceCart(
  cart: Cart,
  resolve: (item: {
    testMasterId?: number | null;
    profileCode?: number | null;
  }) => Promise<ResolvedRate>,
): Promise<PricedCart> {
  if (cart.mccCode == null) {
    return {
      mccCode: null,
      lines: cart.items.map((i) => ({ ...i, rate: null, source: 'none' })),
      total: 0,
      hasUnresolved: cart.items.length > 0,
    };
  }

  const lines: PricedLine[] = [];
  for (const item of cart.items) {
    const rr = await resolve(
      item.kind === 'profile'
        ? { profileCode: item.id }
        : { testMasterId: item.id },
    );
    lines.push({ ...item, rate: rr.rate, source: rr.source });
  }

  const total = lines.reduce((s, l) => s + (l.rate ?? 0), 0);
  const hasUnresolved = lines.some((l) => l.rate == null);
  return { mccCode: cart.mccCode, lines, total, hasUnresolved };
}
