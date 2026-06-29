import { cn } from '@/lib/utils';

/**
 * Server-rendered summary stat card. Extracted from the inline StatCard on the
 * /balances/[mcc] page so the Sales and Client-Accounts pages share one look.
 * `variant` shifts only the value colour so the hierarchy reads at a glance.
 */
export function StatCard({
  label,
  value,
  hint,
  variant = 'default',
  breakdown,
}: {
  label: string;
  value: string;
  hint?: string;
  variant?: 'default' | 'positive' | 'warning' | 'muted';
  breakdown?: { label: string; value: string; sub?: string }[];
}) {
  const valueColor =
    variant === 'positive'
      ? 'text-secondary'
      : variant === 'warning'
        ? 'text-destructive'
        : variant === 'muted'
          ? 'text-muted-foreground'
          : 'text-foreground';
  return (
    <div className="rounded-xl border border-foreground/5 bg-card p-4">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-1 text-2xl font-bold tracking-tight', valueColor)}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      {breakdown && breakdown.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-foreground/5 pt-2">
          {breakdown.map((b) => (
            <div
              key={b.label}
              className="flex items-baseline justify-between text-xs"
            >
              <span className="text-muted-foreground">{b.label}</span>
              <span>
                <span className="font-medium">{b.value}</span>
                {b.sub && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    · {b.sub}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
