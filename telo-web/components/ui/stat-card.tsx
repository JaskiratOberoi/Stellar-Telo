import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Server-rendered summary stat card. Shared by the Balances, Sales and
 * Client-Accounts pages so accounting stats read the same everywhere.
 * `variant` shifts only the value colour so the hierarchy reads at a glance;
 * `icon` (optional) renders a tinted glyph chip in the top-right.
 */
export function StatCard({
  label,
  value,
  hint,
  variant = 'default',
  breakdown,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  variant?: 'default' | 'positive' | 'warning' | 'muted';
  breakdown?: { label: string; value: string; sub?: string }[];
  icon?: ReactNode;
}) {
  const valueColor =
    variant === 'positive'
      ? 'text-success'
      : variant === 'warning'
        ? 'text-destructive'
        : variant === 'muted'
          ? 'text-muted-foreground'
          : 'text-foreground';
  const iconChip =
    variant === 'positive'
      ? 'bg-success/10 text-success'
      : variant === 'warning'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-primary/10 text-primary';
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-elevation-1 transition-shadow hover:shadow-elevation-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {icon && (
          <span
            aria-hidden
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md [&>svg]:h-4 [&>svg]:w-4',
              iconChip,
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p
        className={cn(
          'mt-1 text-2xl font-bold tracking-tight tabular-nums',
          valueColor,
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      {breakdown && breakdown.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border/60 pt-2">
          {breakdown.map((b) => (
            <div
              key={b.label}
              className="flex items-baseline justify-between text-xs"
            >
              <span className="text-muted-foreground">{b.label}</span>
              <span className="tabular-nums">
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
