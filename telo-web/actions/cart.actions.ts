'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/auth/guards';
import { assertMccInScope } from '@/auth/scope';
import { getCart, saveCart, clearCart } from '@/db/cartStore';
import { resolveRatesBatch } from '@/db/sp/resolveRate';
import { priceCart } from '@/domain/cart/price';
import type { CartItem, PricedCart } from '@/domain/cart/cart.types';
import { AppError } from '@/lib/errors';

type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  if (e instanceof AppError) return { ok: false, error: e.message };
  return { ok: false, error: 'Something went wrong.' };
}

/** Choose the collection centre this order is for (must be in scope). */
export async function setCartMcc(mccCode: number): Promise<ActionResult> {
  try {
    const user = await requireCapability('order:create');
    await assertMccInScope(user.uid, mccCode);
    const cart = await getCart(user.uid);
    await saveCart(user.uid, { ...cart, mccCode });
    revalidatePath('/cart');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function addToCart(item: CartItem): Promise<ActionResult> {
  try {
    const user = await requireCapability('order:create');
    const cart = await getCart(user.uid);
    const exists = cart.items.some(
      (i) => i.id === item.id && i.kind === item.kind,
    );
    if (!exists) cart.items.push(item);
    await saveCart(user.uid, cart);
    revalidatePath('/cart');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeFromCart(
  id: number,
  kind: CartItem['kind'],
): Promise<ActionResult> {
  try {
    const user = await requireCapability('order:create');
    const cart = await getCart(user.uid);
    cart.items = cart.items.filter(
      (i) => !(i.id === id && i.kind === kind),
    );
    await saveCart(user.uid, cart);
    revalidatePath('/cart');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function clearMyCart(): Promise<ActionResult> {
  try {
    const user = await requireCapability('order:create');
    await clearCart(user.uid);
    revalidatePath('/cart');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Authoritative server-side rate preview. Client price is never trusted.
 *
 * Uses the batched resolver so an N-item cart costs ONE round-trip to Noble
 * (was N — each line was a separate `usp_telo_resolve_rate` call, each one
 * a WAN hop to the India SQL server).
 */
export async function getPricedCart(): Promise<PricedCart> {
  const user = await requireCapability('order:create');
  const cart = await getCart(user.uid);
  if (cart.mccCode != null) {
    // Re-validate scope on every pricing pass (defence in depth).
    await assertMccInScope(user.uid, cart.mccCode);
  }
  return priceCart(cart, (items) => resolveRatesBatch(items));
}
