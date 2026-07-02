'use client';

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  FileText,
  FlaskConical,
  Home,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  TestTubes,
  TrendingUp,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { signOutAction } from '@/actions/auth.actions';
import { VersionBadge } from '@/components/ui/version-badge';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { cn } from '@/lib/utils';

export interface ShellNavLink {
  href: string;
  label: string;
}

interface AppShellProps {
  userName: string;
  roleName: string | null;
  /** Ordered, role-filtered nav links — the first entry is the user's home. */
  links: ShellNavLink[];
  cartCount?: number;
  homeHref?: string;
  children: ReactNode;
}

/* Icons are looked up client-side by href (component refs can't cross the
   server→client boundary). Unknown routes fall back to a neutral glyph. */
const NAV_ICONS: Record<string, LucideIcon> = {
  '/home': Home,
  '/dashboard': LayoutDashboard,
  '/orders/new': FlaskConical,
  '/orders/b2b': Users,
  '/catalog': TestTubes,
  '/balances': Wallet,
  '/client-accounts': Building2,
  '/sales': TrendingUp,
  '/reporting': FileText,
  '/admin': Settings,
};

const COLLAPSE_KEY = 'telo-sidebar-collapsed';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || 'U';
}

/**
 * The revamped application shell:
 *  - Desktop (lg+): brand-navy sidebar, collapsible to an icon rail
 *    (persisted in localStorage), with the user card + theme toggle docked
 *    at the bottom.
 *  - Mobile: slim frosted top bar + native-app bottom tab bar (first four
 *    destinations) with a "More" sheet for the rest, user info and sign-out.
 * All chrome is print-hidden. The cart fly-chip hooks are preserved:
 * [data-cart-target] lives on the sidebar "New order" item.
 */
export function AppShell({
  userName,
  roleName,
  links,
  cartCount = 0,
  homeHref = '/dashboard',
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* private mode */
    }
  }, []);

  // Never leave the More sheet hanging over a freshly navigated page.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Esc closes the sheet (basic dialog semantics without a portal dep).
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* private mode */
      }
      return !c;
    });
  }, []);

  const isActive = useCallback(
    (href: string) => {
      if (href === homeHref) return pathname === homeHref;
      return pathname.startsWith(href);
    },
    [pathname, homeHref],
  );

  /** Shared per-link routing rules (cart shortcut + prefetch weight). */
  function linkMeta(n: ShellNavLink) {
    const isOrdersLink = n.href === '/orders/new';
    const showBadge = isOrdersLink && cartCount > 0;
    return {
      isOrdersLink,
      showBadge,
      // Cart has items → skip the worklist and open the order form directly.
      href: showBadge ? '/orders/new/create' : n.href,
      heavy: n.href === '/admin' || isOrdersLink,
      Icon: NAV_ICONS[n.href] ?? LayoutDashboard,
    };
  }

  const tabLinks = links.slice(0, 4);
  const overflowLinks = links.slice(4);

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside
        aria-label="Primary"
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-gradient-to-b from-sidebar to-sidebar-deep text-sidebar-foreground lg:flex',
          'transition-[width] duration-200 ease-out motion-reduce:transition-none',
          collapsed ? 'w-[76px]' : 'w-64',
          'print:hidden',
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            'flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border/60',
            collapsed ? 'justify-center px-0' : 'px-4',
          )}
        >
          <Link
            href={homeHref}
            className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-active"
            aria-label="Telo home"
          >
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary via-primary to-chart-5 text-[15px] font-black text-white shadow-elevation-2"
            >
              T
            </span>
            {!collapsed && (
              <span className="flex items-center gap-1.5">
                <span className="text-lg font-bold tracking-tight">Telo</span>
                <VersionBadge className="border-white/15 bg-white/10 text-sidebar-muted" />
              </span>
            )}
          </Link>
        </div>

        {/* Nav */}
        <nav
          className={cn(
            'flex-1 space-y-1 overflow-y-auto py-4',
            collapsed ? 'px-3' : 'px-3',
          )}
        >
          {links.map((n) => {
            const { href, showBadge, heavy, Icon, isOrdersLink } = linkMeta(n);
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={href}
                prefetch={heavy ? false : undefined}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? n.label : undefined}
                data-cart-target={isOrdersLink ? '' : undefined}
                className={cn(
                  'group relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium outline-none transition-colors duration-150',
                  collapsed ? 'justify-center px-0' : 'px-3',
                  active
                    ? 'bg-white/10 text-white'
                    : 'text-sidebar-muted hover:bg-white/5 hover:text-white',
                  'focus-visible:ring-2 focus-visible:ring-sidebar-active',
                )}
              >
                {/* Active indicator rail */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-active transition-all duration-200',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
                    collapsed && '-left-3',
                  )}
                />
                <span className="relative shrink-0">
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px] transition-transform duration-150 group-hover:scale-110 motion-reduce:transition-none',
                      active && 'text-sidebar-active',
                    )}
                    aria-hidden
                  />
                  {showBadge && collapsed && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-secondary px-1 text-[9px] font-bold text-secondary-foreground">
                      {cartCount}
                    </span>
                  )}
                </span>
                {!collapsed && (
                  <>
                    <span className="truncate">{n.label}</span>
                    {showBadge && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1.5 text-[10px] font-bold text-secondary-foreground animate-pop">
                        {cartCount}
                      </span>
                    )}
                  </>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer: collapse toggle, theme, user, sign out */}
        <div className="shrink-0 space-y-2 border-t border-sidebar-border/60 p-3">
          <div
            className={cn(
              'flex items-center gap-1',
              collapsed ? 'flex-col' : 'justify-between px-1',
            )}
          >
            <ThemeToggle className="text-sidebar-muted hover:bg-white/5 hover:text-white focus-visible:ring-sidebar-active" />
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-active"
            >
              {mounted && collapsed ? (
                <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden />
              ) : (
                <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />
              )}
            </button>
          </div>

          <div
            className={cn(
              'flex items-center gap-2.5 rounded-xl bg-white/5 p-2.5',
              collapsed && 'flex-col p-2',
            )}
          >
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-chart-5 to-primary text-[11px] font-bold text-white"
            >
              {initials(userName)}
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-tight">
                  {userName}
                </span>
                {roleName && (
                  <span className="block truncate text-[10px] uppercase tracking-wide text-sidebar-muted">
                    {roleName}
                  </span>
                )}
              </span>
            )}
            <form action={signOutAction}>
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-active"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* ── Mobile top bar ──────────────────────────────────────────────── */}
      <header className="glass sticky top-0 z-40 border-b border-border/60 lg:hidden print:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link
            href={homeHref}
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-label="Telo home"
          >
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary via-primary to-chart-5 text-sm font-black text-white shadow-elevation-2"
            >
              T
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-base font-bold tracking-tight">Telo</span>
              <VersionBadge />
            </span>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'lg:transition-[padding-left] lg:duration-200 lg:ease-out motion-reduce:transition-none',
          collapsed ? 'lg:pl-[76px]' : 'lg:pl-64',
        )}
      >
        <main className="relative z-10 mx-auto w-full max-w-[1400px] px-4 py-6 pb-28 sm:px-6 lg:px-8 lg:pb-10 print:max-w-none print:p-0">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom tab bar ───────────────────────────────────────── */}
      <nav
        aria-label="Primary"
        className="glass fixed inset-x-0 bottom-0 z-40 border-t border-border/60 pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${tabLinks.length + 1}, 1fr)` }}
        >
          {tabLinks.map((n) => {
            const { href, showBadge, heavy, Icon } = linkMeta(n);
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={href}
                prefetch={heavy ? false : undefined}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center gap-0.5 py-2 pt-2.5 text-[10px] font-medium outline-none transition-colors',
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                  'focus-visible:ring-2 focus-visible:ring-ring/40',
                )}
              >
                <span className="relative">
                  <Icon
                    className={cn(
                      'h-5 w-5 transition-transform duration-150',
                      active && 'scale-110',
                    )}
                    aria-hidden
                  />
                  {showBadge && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-secondary px-1 text-[9px] font-bold text-secondary-foreground">
                      {cartCount}
                    </span>
                  )}
                </span>
                <span className="max-w-[72px] truncate">{n.label}</span>
                {/* Active dot */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-0.5 h-1 w-1 rounded-full bg-primary transition-opacity',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className="flex flex-col items-center gap-0.5 py-2 pt-2.5 text-[10px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden />
            More
          </button>
        </div>
      </nav>

      {/* ── Mobile "More" sheet ─────────────────────────────────────────── */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="More navigation"
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-[2px]"
          />
          <div className="absolute inset-x-0 bottom-0 animate-slide-up rounded-t-2xl border-t border-border bg-card pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-elevation-4">
            <div className="flex items-center justify-between px-5 pb-1 pt-4">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-chart-5 to-primary text-xs font-bold text-white"
                >
                  {initials(userName)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {userName}
                  </span>
                  {roleName && (
                    <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                      {roleName}
                    </span>
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            {overflowLinks.length > 0 && (
              <nav className="grid grid-cols-1 gap-0.5 px-3 py-2">
                {overflowLinks.map((n) => {
                  const { href, heavy, Icon } = linkMeta(n);
                  const active = isActive(n.href);
                  return (
                    <Link
                      key={n.href}
                      href={href}
                      prefetch={heavy ? false : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors',
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground hover:bg-muted',
                      )}
                    >
                      <Icon className="h-5 w-5" aria-hidden />
                      {n.label}
                    </Link>
                  );
                })}
              </nav>
            )}

            <div className="mx-3 my-1 border-t border-border/60" />
            <div className="flex items-center justify-between px-5 py-2">
              <span className="text-sm text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
            <form action={signOutAction} className="px-3 pb-2">
              <button
                type="submit"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                <LogOut className="h-5 w-5" aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
