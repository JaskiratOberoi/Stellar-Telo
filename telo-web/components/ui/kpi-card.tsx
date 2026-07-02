'use client';

import { cn } from '@/lib/utils';

type KpiVariant = 'plain' | 'light' | 'accent';

interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  variant?: KpiVariant;
  trend?: 'up' | 'down' | 'neutral';
  className?: string;
}

const variantClasses: Record<KpiVariant, string> = {
  plain:
    'bg-card border border-border/70 text-foreground shadow-elevation-1 hover:shadow-elevation-2 transition-shadow',
  light: 'card-light',
  accent: 'card-accent',
};

export function KpiCard({
  label,
  value,
  hint,
  variant = 'plain',
  trend,
  className,
}: KpiCardProps) {
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : null;
  const trendColor =
    trend === 'up'
      ? 'text-success'
      : trend === 'down'
        ? 'text-destructive'
        : '';

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-xl p-4',
        variantClasses[variant],
        className,
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wider opacity-60">
        {label}
      </p>
      <p className="animate-fade-in-up text-2xl font-bold leading-none tracking-tight tabular-nums">
        {value}
        {trendIcon && (
          <span className={cn('ml-1 text-sm font-normal', trendColor)}>
            {trendIcon}
          </span>
        )}
      </p>
      {hint && <p className="text-xs opacity-50">{hint}</p>}
    </div>
  );
}
