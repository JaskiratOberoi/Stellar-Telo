import 'server-only';
import { redis } from '@/lib/cache';
import { type Cart, EMPTY_CART } from '@/domain/cart/cart.types';

/**
 * Per-user cart, persisted in redis (keyed by uid). Carts are ephemeral
 * shopping state, not order data — a 24h TTL is fine. Redis-down degrades to
 * an empty cart (the user just re-adds items); never throws to the request.
 */
const TTL = 60 * 60 * 24;
const key = (uid: number) => `telo:cart:${uid}`;

export async function getCart(uid: number): Promise<Cart> {
  try {
    const raw = await redis().get(key(uid));
    if (!raw) return { ...EMPTY_CART };
    const parsed = JSON.parse(raw) as Cart;
    return {
      mccCode: parsed.mccCode ?? null,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { ...EMPTY_CART };
  }
}

export async function saveCart(uid: number, cart: Cart): Promise<void> {
  try {
    await redis().set(key(uid), JSON.stringify(cart), 'EX', TTL);
  } catch {
    /* best-effort: cart is non-critical ephemeral state */
  }
}

export async function clearCart(uid: number): Promise<void> {
  try {
    await redis().del(key(uid));
  } catch {
    /* best-effort */
  }
}
