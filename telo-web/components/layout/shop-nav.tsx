'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutAction } from '@/actions/auth.actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NavLink {
  href: string;
  label: string;
}

interface ShopNavProps {
  userName: string;
  roleName: string | null;
  links: NavLink[];
  cartCount?: number;
  /** Where the Telo brand mark links to (Dashboard for most users,
   *  `/orders/new` for Technicians who don't have dashboard:view). */
  homeHref?: string;
}

export function ShopNav({
  userName,
  roleName,
  links,
  cartCount = 0,
  homeHref = '/dashboard',
}: ShopNavProps) {
  const pathname = usePathname();

  function isActive(href: string) {
    // Exact-match for the home route (so /orders/new doesn't also light up
    // every Telo brand click when it happens to be the technician's home).
    if (href === homeHref) return pathname === homeHref;
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-card/80 backdrop-blur-sm print:hidden">
      <div className="container flex h-14 items-center justify-between">
        <nav className="flex items-center gap-1 text-sm font-medium">
          <Link
            href={homeHref}
            className={cn(
              'rounded-md px-3 py-1.5 font-semibold tracking-tight transition-colors',
              pathname === homeHref
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="text-primary">Telo</span>
          </Link>

          <span className="mx-1 h-4 w-px bg-white/10" />

          {links.map((n) => {
            const isOrdersLink = n.href === '/orders/new';
            const showBadge = isOrdersLink && cartCount > 0;
            // Cart has items → skip the worklist and open the order form directly.
            const href = showBadge ? '/orders/new/create' : n.href;
            return (
              <Link
                key={n.href}
                href={href}
                aria-current={isActive(n.href) ? 'page' : undefined}
                // Tagged so AddToCartButton can fly its chip here.
                data-cart-target={isOrdersLink ? '' : undefined}
                className={cn(
                  'relative rounded-md px-3 py-1.5 transition-all duration-150',
                  isActive(n.href)
                    ? 'bg-primary/15 text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
                )}
              >
                {n.label}
                {showBadge && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-secondary px-1 text-[9px] font-bold text-secondary-foreground">
                    {cartCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          <span className="hidden sm:flex items-center gap-1.5 text-muted-foreground">
            <span>{userName}</span>
            {roleName && (
              <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {roleName}
              </span>
            )}
          </span>
          <form action={signOutAction}>
            <Button variant="outline" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
