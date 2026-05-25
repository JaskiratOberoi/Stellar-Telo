import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { signOut } from '@/auth/config';
import { hasCapability } from '@/auth/rbac';
import { Button } from '@/components/ui/button';
import type { Capability } from '@/types/auth';

interface NavItem {
  href: string;
  label: string;
  cap: Capability | null; // null = visible to anyone with a session
}

// One source of truth for nav visibility per Telo role (via capabilities).
const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', cap: null },
  { href: '/orders/new', label: 'New order', cap: 'order:view' },
  { href: '/catalog', label: 'Catalog', cap: 'patient:create' },
  { href: '/patient', label: 'Patients', cap: 'patient:view' },
  { href: '/orders', label: 'Orders', cap: 'order:view' },
  { href: '/rate-lists', label: 'Rate lists', cap: 'rate:view' },
  { href: '/balances', label: 'Accounts', cap: 'balance:view' },
  { href: '/admin/users', label: 'Admin', cap: 'user:manage' },
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

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="container flex h-14 items-center justify-between">
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/dashboard" className="font-semibold">
              Telo
            </Link>
            {visible
              .filter((n) => n.href !== '/dashboard')
              .map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {n.label}
                </Link>
              ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {user.name}
              {user.teloRole
                ? ` · ${user.teloRole.replace('_', ' ')}`
                : user.usertypeName
                  ? ` · ${user.usertypeName}`
                  : ''}
            </span>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            >
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="container py-4">{children}</main>
    </div>
  );
}
