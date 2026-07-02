'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { MccPeriod } from '@/components/balances/mcc-balance-filters';

/**
 * Period presets + From/To date pickers for the client accounting dashboard.
 * Navigates with a full browser navigation (window.location.assign) for the
 * same force-dynamic reason documented in mcc-balance-filters.tsx.
 */
export function AccountingFilters({
  mccId,
  from,
  to,
  periods,
  activeLabel,
  maxDate,
}: {
  mccId: number;
  from: string;
  to: string;
  periods: MccPeriod[];
  activeLabel: string | null;
  maxDate: string;
}) {
  const [fromLocal, setFromLocal] = useState(from);
  const [toLocal, setToLocal] = useState(to);
  const [navigating, setNavigating] = useState(false);
  useEffect(() => setFromLocal(from), [from]);
  useEffect(() => setToLocal(to), [to]);

  const navigate = (f: string, t: string) => {
    const lo = f <= t ? f : t;
    const hi = f <= t ? t : f;
    setNavigating(true);
    window.location.assign(`/balances/${mccId}/dashboard?from=${lo}&to=${hi}`);
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-0.5">
        <label className="text-xs text-muted-foreground">From</label>
        <Input
          type="date"
          value={fromLocal}
          max={toLocal || maxDate}
          disabled={navigating}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            setFromLocal(v);
            navigate(v, toLocal);
          }}
          className="h-8 w-full sm:w-40"
        />
      </div>
      <div className="space-y-0.5">
        <label className="text-xs text-muted-foreground">To</label>
        <Input
          type="date"
          value={toLocal}
          min={fromLocal}
          max={maxDate}
          disabled={navigating}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            setToLocal(v);
            navigate(fromLocal, v);
          }}
          className="h-8 w-full sm:w-40"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 self-end rounded-full border border-border/70 bg-card p-1 shadow-elevation-1">
        {periods.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={navigating}
            onClick={() => navigate(p.from, p.to)}
            aria-pressed={p.label === activeLabel}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              p.label === activeLabel
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              navigating && 'cursor-wait opacity-70',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
