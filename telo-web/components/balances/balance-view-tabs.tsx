import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Segmented Dashboard | Bills toggle for a client (MCC) drill-down. Link-based
 * (server-friendly), preserves the active date range. Rendered on both
 * /balances/[mcc]/dashboard and /balances/[mcc] for multi-client users.
 */
export function BalanceViewTabs({
  mccId,
  from,
  to,
  active,
}: {
  mccId: number;
  from: string;
  to: string;
  active: 'dashboard' | 'bills';
}) {
  const qs = `from=${from}&to=${to}`;
  const tabs: { key: 'dashboard' | 'bills'; label: string; href: string }[] = [
    { key: 'dashboard', label: 'Dashboard', href: `/balances/${mccId}/dashboard?${qs}` },
    { key: 'bills', label: 'Bills', href: `/balances/${mccId}?${qs}` },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card p-1 shadow-elevation-1">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'rounded-full px-4 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              on
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
