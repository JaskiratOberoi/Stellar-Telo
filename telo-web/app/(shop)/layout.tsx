import { requireSession } from '@/auth/session';
import { hasCapability, lisUsertypeToTeloRole } from '@/auth/rbac';
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
  // B2C "New order" tab — gated on order:b2c so B2B-only roles (b2b_billing)
  // don't see it.
  { href: '/orders/new', label: 'New order', cap: 'order:b2c' },
  // B2B "Patient Orders" — same flow, bills at MRP and shows the client margin.
  // Gated on order:b2b so B2C-only roles (b2c_billing) don't see it; also
  // hidden for MRP-only accounts (e.g. MDCARE) below.
  { href: '/orders/b2b', label: 'Patient Orders', cap: 'order:b2b' },
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
  // Top-level /audit (not /admin/audit) so the Admin tab's startsWith active
  // check doesn't light up for it too.
  { href: '/audit', label: 'Audit trail', cap: 'user:manage' },
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
  const canB2c = hasCapability(user.caps, 'order:b2c');
  const canB2b = hasCapability(user.caps, 'order:b2b');
  const cartCount = canCreate ? (await getCart(user.uid)).items.length : 0;

  // User's "home" — B2B clients (client / b2b_billing) land on the animated
  // payment home; Technicians on the New Order worklist; everyone else on the
  // Dashboard. The Telo brand mark navigates here. Use the EFFECTIVE role: most
  // clients are implicit (derived from their LIS usertypeid), so `teloRole`
  // (explicit override only) is null for them — fall back to the LIS-derived role.
  const effectiveRole = user.teloRole ?? lisUsertypeToTeloRole(user.usertypeId);
  const homeHref =
    effectiveRole === 'client' ||
    effectiveRole === 'b2b_billing' ||
    effectiveRole === 'client_reporting'
      ? '/home'
      : hasCapability(user.caps, 'dashboard:view')
        ? '/dashboard'
        : // Reporting-only roles (report_admin) have no orders/dashboard —
          // land them straight on the Reporting tab, not an order worklist.
          hasCapability(user.caps, 'report:view')
          ? '/reporting'
          : canB2c
            ? '/orders/new'
            : '/orders/b2b';

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
      <NewOrderFab
        canCreate={canCreate}
        canB2c={canB2c}
        canB2b={canB2b}
        cartCount={cartCount}
      />
    </div>
  );
}
