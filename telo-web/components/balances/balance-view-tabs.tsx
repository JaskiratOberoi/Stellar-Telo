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
    <div className="inline-flex items-center gap-1 rounded-full border border-foreground/10 bg-card/60 p-1">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={cn(
              'rounded-full px-4 py-1 text-xs font-medium transition-all duration-150',
              on
                ? 'bg-primary/25 text-foreground'
                : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
