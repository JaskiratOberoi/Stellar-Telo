import type { CatalogKind } from '@/domain/catalog/catalog.types';
import type { RateSource } from '@/db/sp/resolveRate';

/** A line the user added — identity only. Price is NEVER stored here; it is
 *  re-resolved server-side against the selected MCC at preview/checkout. */
export interface CartItem {
  id: number; // test_master.id or profile_master.id
  kind: CatalogKind;
  code: string;
  name: string;
}

export interface Cart {
  mccCode: number | null; // which collection centre this order is for
  items: CartItem[];
}

/** A cart line enriched with the authoritative server-resolved price. */
export interface PricedLine extends CartItem {
  rate: number | null;
  source: RateSource;
}

export interface PricedCart {
  mccCode: number | null;
  lines: PricedLine[];
  total: number; // sum of resolved rates (lines with null rate excluded)
  hasUnresolved: boolean;
}

export const EMPTY_CART: Cart = { mccCode: null, items: [] };
