import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { fetchMrpOnly } from '@/db/read/teloUsers';
import type { Capability } from '@/types/auth';
import { ShopNav } from '@/components/layout/shop-nav';
import { NewOrderFab } from '@/components/layout/new-order-fab';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { getCart } from '@/db/cartStore';

interface NavItem {
  href: string;
  label: string;
  cap: Capability | null; // null = visible to anyone with a session
}

// One source of truth for nav visibility per Telo role (via capabilities).
// Focused billing mode — Orders, Rate lists, Patients tabs are hidden globally.
// The corresponding pages also redirect to /dashboard so URL-typing closes the
// door too. Un-comment + remove the redirects to re-enable.
const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', cap: 'dashboard:view' },
  { href: '/orders/new', label: 'New order', cap: 'order:view' },
  // B2B Orders — same flow, bills at MRP and shows the client margin. Hidden
  // for MRP-only accounts (e.g. MDCARE) below.
  { href: '/orders/b2b', label: 'B2B Orders', cap: 'order:create' },
  { href: '/catalog', label: 'Catalog', cap: 'patient:create' },
  // { href: '/patient', label: 'Patients', cap: 'patient:view' },
  // { href: '/orders', label: 'Orders', cap: 'order:view' },
  // { href: '/rate-lists', label: 'Rate lists', cap: 'rate:view' },
  { href: '/balances', label: 'Accounts', cap: 'balance:view' },
  { href: '/client-accounts', label: 'Client Accounts', cap: 'account:view' },
  { href: '/sales', label: 'Sales', cap: 'sales:view' },
  { href: '/reporting', label: 'Reporting', cap: 'report:view' },
  // href: '/admin' so the active-link indicator covers /admin/users AND
  // /admin/invoice (ShopNav uses pathname.startsWith(href)).
  { href: '/admin', label: 'Admin', cap: 'user:manage' },
];

export default async function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireSession();

  // MRP-only accounts (e.g. MDCARE) don't get the B2B Orders feature.
  const mrpOnly = await fetchMrpOnly(user.uid);

  const visible = NAV.filter(
    (n) =>
      (n.cap == null || hasCapability(user.caps, n.cap)) &&
      !(n.href === '/orders/b2b' && mrpOnly),
  );

  const navLinks = visible.filter((n) => n.href !== '/dashboard');
  const roleName =
    user.teloRole
      ? user.teloRole.replace('_', ' ')
      : user.usertypeName ?? null;

  // Cart count for the "New order" badge — only relevant for order:create users.
  const canCreate = hasCapability(user.caps, 'order:create');
  const cartCount = canCreate ? (await getCart(user.uid)).items.length : 0;

  // User's "home" — Dashboard for everyone except Technicians, who land
  // directly on the New Order worklist. The Telo brand mark navigates here.
  const homeHref = hasCapability(user.caps, 'dashboard:view')
    ? '/dashboard'
    : '/orders/new';

  return (
    <div className="relative min-h-screen bg-background">
      {/* Pinned behind all content so dense screens stay readable. */}
      <AmbientBackground subtle className="fixed" />
      <ShopNav
        userName={user.name}
        roleName={roleName}
        links={navLinks}
        cartCount={cartCount}
        homeHref={homeHref}
      />
      <main className="container relative z-10 py-6 print:p-0 print:max-w-none">
        {children}
      </main>
      {/* Global FAB — register a new order from anywhere. Self-gates on
          capability/route. Badge mirrors the navbar cart count. */}
      <NewOrderFab canCreate={canCreate} cartCount={cartCount} />
    </div>
  );
}
