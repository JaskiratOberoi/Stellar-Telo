'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { signOutAction } from '@/actions/auth.actions';
import { Button } from '@/components/ui/button';
import { VersionBadge } from '@/components/ui/version-badge';
import { ThemeToggle } from '@/components/theme/theme-toggle';
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

/** First letters of the first two words — the avatar chip's initials. */
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
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
    const active = isActive(n.href);
    return (
      <Link
        key={n.href}
        href={href}
        prefetch={heavyRoute ? false : undefined}
        aria-current={active ? 'page' : undefined}
        onClick={() => setOpen(false)}
        // Tag only the desktop link so the cart fly-chip targets a visible node
        // (the FAB is the mobile fallback).
        data-cart-target={isOrdersLink && variant === 'bar' ? '' : undefined}
        className={cn(
          'relative rounded-full transition-all duration-150',
          variant === 'bar' ? 'px-3.5 py-1.5' : 'rounded-lg px-3 py-2.5 text-[15px]',
          active
            ? 'bg-primary/10 font-semibold text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]'
            : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
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

  const brand = (
    <Link
      href={homeHref}
      className="group flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1"
    >
      {/* Gradient glyph tile */}
      <span className="flex h-7 w-7 items-center justify-center rounded-[0.6rem] bg-gradient-to-br from-primary to-[hsl(var(--brand-2))] font-display text-sm font-bold text-white shadow-glow transition-transform duration-200 group-hover:scale-105">
        T
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="font-display text-lg font-bold tracking-tight text-foreground">
          Telo
        </span>
        <VersionBadge />
      </span>
    </Link>
  );

  const userChip = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-[hsl(var(--brand-2)/0.2)] text-[10px] font-bold text-primary ring-1 ring-primary/20">
        {initialsOf(userName)}
      </span>
      <span className="hidden min-w-0 flex-col leading-tight xl:flex">
        <span className="max-w-[11rem] truncate text-xs font-semibold">
          {userName}
        </span>
        {roleName && (
          <span className="text-[9px] font-medium uppercase tracking-widest text-muted-foreground">
            {roleName}
          </span>
        )}
      </span>
    </span>
  );

  return (
    <header className="sticky top-0 z-40 px-2 pt-2 sm:px-4 sm:pt-3 print:hidden">
      {/* Floating glass bar */}
      <div className="glass container flex h-14 items-center justify-between gap-2 rounded-2xl shadow-card">
        {/* Brand + desktop links */}
        <div className="flex min-w-0 items-center gap-2">
          {brand}

          <span className="mx-1 hidden h-5 w-px bg-foreground/10 md:inline-block" />

          <nav className="hidden items-center gap-0.5 text-sm font-medium md:flex">
            {links.map((n) => renderLink(n, 'bar'))}
          </nav>
        </div>

        {/* Right cluster: user chip + theme + sign out (desktop), hamburger (mobile) */}
        <div className="flex items-center gap-1.5 text-sm sm:gap-2.5">
          <span className="hidden lg:flex">{userChip}</span>
          {/* Light/dark toggle — visible on every screen size. */}
          <ThemeToggle />

          <form action={signOutAction} className="hidden md:block">
            <Button variant="ghost" size="sm" type="submit" className="text-muted-foreground">
              Sign out
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground md:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer — floats below the bar as its own glass sheet */}
      {open && (
        <div className="glass container mt-2 rounded-2xl shadow-card md:hidden">
          <nav className="flex flex-col gap-0.5 px-2 py-2 text-sm font-medium">
            {links.map((n) => renderLink(n, 'drawer'))}
          </nav>
          <div className="flex items-center justify-between border-t border-foreground/5 px-3 py-3">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-[hsl(var(--brand-2)/0.2)] text-[10px] font-bold text-primary ring-1 ring-primary/20">
                {initialsOf(userName)}
              </span>
              <span className="max-w-[40vw] truncate text-xs font-semibold text-foreground">
                {userName}
              </span>
              {roleName && (
                <span className="shrink-0 rounded-full border border-foreground/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-widest text-muted-foreground">
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
