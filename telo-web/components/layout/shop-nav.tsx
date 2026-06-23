'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { signOutAction } from '@/actions/auth.actions';
import { Button } from '@/components/ui/button';
import { VersionBadge } from '@/components/ui/version-badge';
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
  const [open, setOpen] = useState(false);

  // Close the mobile drawer on navigation so it never lingers over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function isActive(href: string) {
    // Exact-match for the home route (so /orders/new doesn't also light up
    // every Telo brand click when it happens to be the technician's home).
    if (href === homeHref) return pathname === homeHref;
    return pathname.startsWith(href);
  }

  // One renderer for both the desktop strip and the mobile drawer so the cart
  // badge / active state / prefetch rules stay in sync.
  function renderLink(n: NavLink, variant: 'bar' | 'drawer') {
    const isOrdersLink = n.href === '/orders/new';
    const showBadge = isOrdersLink && cartCount > 0;
    // Cart has items → skip the worklist and open the order form directly.
    const href = showBadge ? '/orders/new/create' : n.href;
    // Disable prefetch for heavy admin / order routes — see note below.
    const heavyRoute = n.href === '/admin' || isOrdersLink;
    return (
      <Link
        key={n.href}
        href={href}
        prefetch={heavyRoute ? false : undefined}
        aria-current={isActive(n.href) ? 'page' : undefined}
        onClick={() => setOpen(false)}
        // Tag only the desktop link so the cart fly-chip targets a visible node
        // (the FAB is the mobile fallback).
        data-cart-target={isOrdersLink && variant === 'bar' ? '' : undefined}
        className={cn(
          'relative rounded-md transition-all duration-150',
          variant === 'bar' ? 'px-3 py-1.5' : 'px-3 py-2.5 text-[15px]',
          isActive(n.href)
            ? 'bg-primary/15 text-foreground font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
        )}
      >
        {n.label}
        {showBadge && (
          <span
            className={cn(
              'flex h-4 min-w-4 items-center justify-center rounded-full bg-secondary px-1 text-[9px] font-bold text-secondary-foreground',
              variant === 'bar'
                ? 'absolute -top-1 -right-1'
                : 'ml-2 inline-flex',
            )}
          >
            {cartCount}
          </span>
        )}
      </Link>
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-card/80 backdrop-blur-sm print:hidden">
      <div className="container flex h-14 items-center justify-between gap-2">
        {/* Brand + desktop links */}
        <div className="flex min-w-0 items-center gap-1">
          <Link
            href={homeHref}
            className={cn(
              'shrink-0 rounded-md px-2 py-1.5 font-semibold tracking-tight transition-colors sm:px-3',
              pathname === homeHref
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="text-primary">Telo</span>
              <VersionBadge />
            </span>
          </Link>

          <span className="mx-1 hidden h-4 w-px bg-white/10 md:inline-block" />

          <nav className="hidden items-center gap-1 text-sm font-medium md:flex">
            {links.map((n) => renderLink(n, 'bar'))}
          </nav>
        </div>

        {/* Right cluster: user/role + sign out (desktop), hamburger (mobile) */}
        <div className="flex items-center gap-2 text-sm sm:gap-3">
          <span className="hidden items-center gap-1.5 text-muted-foreground lg:flex">
            <span className="max-w-[12rem] truncate">{userName}</span>
            {roleName && (
              <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {roleName}
              </span>
            )}
          </span>
          <form action={signOutAction} className="hidden md:block">
            <Button variant="outline" size="sm" type="submit">
              Sign out
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground md:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="border-t border-white/5 bg-card/95 backdrop-blur-sm md:hidden">
          <nav className="container flex flex-col gap-0.5 py-2 text-sm font-medium">
            {links.map((n) => renderLink(n, 'drawer'))}
          </nav>
          <div className="container flex items-center justify-between border-t border-white/5 py-3">
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <span className="max-w-[55vw] truncate">{userName}</span>
              {roleName && (
                <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
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
      )}
    </header>
  );
}
