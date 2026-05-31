import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import type { Capability } from '@/types/auth';
import { ShopNav } from '@/components/layout/shop-nav';
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
  { href: '/catalog', label: 'Catalog', cap: 'patient:create' },
  // { href: '/patient', label: 'Patients', cap: 'patient:view' },
  // { href: '/orders', label: 'Orders', cap: 'order:view' },
  // { href: '/rate-lists', label: 'Rate lists', cap: 'rate:view' },
  { href: '/balances', label: 'Accounts', cap: 'balance:view' },
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

  const visible = NAV.filter(
    (n) => n.cap == null || hasCapability(user.caps, n.cap),
  );

  const navLinks = visible.filter((n) => n.href !== '/dashboard');
  const roleName =
    user.teloRole
      ? user.teloRole.replace('_', ' ')
      : user.usertypeName ?? null;

  // Cart count for the "New order" badge — only relevant for order:create users.
  const cartCount = hasCapability(user.caps, 'order:create')
    ? (await getCart(user.uid)).items.length
    : 0;

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
    </div>
  );
}
