'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { MccPeriod } from '@/components/balances/mcc-balance-filters';

/**
 * Generic period presets + From/To date pickers for a per-MCC drill-down page.
 * Navigates with a full browser navigation (window.location.assign) for the
 * same force-dynamic reason documented in components/balances/mcc-balance-filters.tsx.
 *
 * `basePath` is the route the dates apply to, e.g. '/client-accounts' or
 * '/sales' — navigation targets `${basePath}/${mccId}?from=&to=` (page index
 * resets to 1 implicitly since the param is dropped).
 */
export function DateRangeFilters({
  basePath,
  mccId,
  from,
  to,
  periods,
  activeLabel,
  maxDate,
}: {
  basePath: string;
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
    window.location.assign(`${basePath}/${mccId}?from=${lo}&to=${hi}`);
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
      <div className="flex flex-wrap items-center gap-1 self-end rounded-lg border border-white/5 bg-card p-1">
        {periods.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={navigating}
            onClick={() => navigate(p.from, p.to)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-all duration-150',
              p.label === activeLabel
                ? 'bg-primary/20 text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
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
