'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';

/**
 * Global "New Order" floating action button. Mounted once in the shop layout
 * so it rides along on every main page (Dashboard, New order, Accounts,
 * Catalog, …) instead of living inside a single worklist. Gated by
 * `order:create` — receptionists see it, Technicians don't.
 *
 * Context-aware: on the B2B worklist it registers a B2B order (preserving the
 * old per-worklist shortcut); everywhere else it registers a standard New
 * Order. Hidden on the registration forms themselves (the "/create" routes),
 * where a "start a new order" button is redundant with the form already open.
 *
 * Tagged `data-cart-fab` so the Catalog's add-to-cart chip can fly straight
 * into it now that it's on-page (it falls back to the navbar tab otherwise),
 * and carries a count badge of the items added from the Catalog — the same
 * cart count the navbar tab shows.
 */
export function NewOrderFab({
  canCreate,
  cartCount = 0,
}: {
  canCreate: boolean;
  /** Items currently in the order cart (added from the Catalog). Renders as a
   *  badge, like the navbar "New order" tab. */
  cartCount?: number;
}) {
  const pathname = usePathname();

  if (!canCreate) return null;
  // Already on a registration form — the FAB would just point at the page
  // you're on.
  if (pathname.endsWith('/create')) return null;
  // Read-only reporting sections (Sales, Client Accounts) — registering a new
  // order isn't contextually relevant here and the FAB overlaps the pager/footer.
  if (pathname.startsWith('/sales') || pathname.startsWith('/client-accounts')) {
    return null;
  }

  const isB2b = pathname.startsWith('/orders/b2b');
  const href = isB2b ? '/orders/b2b/create' : '/orders/new/create';
  const label = isB2b ? 'New B2B Order' : 'New Order';

  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={
        cartCount > 0
          ? `Register a ${label.toLowerCase()} — ${cartCount} test${cartCount === 1 ? '' : 's'} in cart`
          : `Register a ${label.toLowerCase()}`
      }
      data-cart-fab=""
      className="fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2 rounded-full bg-primary pl-4 pr-5 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/30 transition-all duration-200 hover:scale-105 active:scale-95 sm:bottom-8 sm:right-8 print:hidden"
    >
      <Plus className="h-5 w-5" strokeWidth={2.5} />
      {label}
      {cartCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1.5 text-[10px] font-bold text-secondary-foreground shadow-md">
          {cartCount}
        </span>
      )}
    </Link>
  );
}
