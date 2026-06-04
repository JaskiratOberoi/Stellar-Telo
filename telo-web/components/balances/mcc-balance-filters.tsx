'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface MccPeriod {
  label: string;
  from: string;
  to: string;
}

/**
 * Period presets + From/To date pickers + "My Accounts Summary" registrar
 * filter for the per-MCC accounts page.
 *
 * Navigation uses a real browser navigation (window.location.assign), NOT
 * router.replace/push. This page is `force-dynamic`, and client-side App Router
 * navigation that only changes the search params hangs here: the RSC request for
 * the new range returns 200 but the router never commits the navigation, leaving
 * the useTransition pending forever (every button stuck disabled). That was the
 * "Today works once, then This week does nothing" bug. A full navigation always
 * re-renders the page fresh on the server and can't get stuck. Verified in-browser.
 */
export function MccBalanceFilters({
  mccId,
  from,
  to,
  mine,
  periods,
  activeLabel,
  userLabel,
  maxDate,
}: {
  mccId: number;
  from: string;
  to: string;
  mine: boolean;
  periods: MccPeriod[];
  activeLabel: string | null;
  userLabel: string;
  maxDate: string;
}) {
  // Mirror the server values locally so the date inputs reflect a pick instantly
  // (before the page reloads); re-sync whenever new props arrive.
  const [fromLocal, setFromLocal] = useState(from);
  const [toLocal, setToLocal] = useState(to);
  const [navigating, setNavigating] = useState(false);
  useEffect(() => setFromLocal(from), [from]);
  useEffect(() => setToLocal(to), [to]);

  const navigate = (f: string, t: string, m: boolean) => {
    // Keep the range sane (from ≤ to) so a stray pick can't invert it.
    const lo = f <= t ? f : t;
    const hi = f <= t ? t : f;
    setNavigating(true);
    window.location.assign(
      `/balances/${mccId}?from=${lo}&to=${hi}${m ? '&mine=1' : ''}`,
    );
  };

  const chip = (active: boolean) =>
    cn(
      'rounded-full px-3 py-1 text-xs transition-all duration-150',
      active
        ? 'bg-primary/20 text-foreground font-medium'
        : 'border border-white/10 text-muted-foreground hover:bg-white/5 hover:text-foreground',
      navigating && 'cursor-wait opacity-70',
    );

  return (
    <div className="space-y-2">
      {/* ── Date range + period quick-select ─────────────────────────── */}
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
              navigate(v, toLocal, mine);
            }}
            className="h-8 w-40"
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
              navigate(fromLocal, v, mine);
            }}
            className="h-8 w-40"
          />
        </div>
        <div className="flex items-center gap-1 self-end rounded-lg border border-white/5 bg-card p-1">
          {periods.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={navigating}
              onClick={() => navigate(p.from, p.to, mine)}
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

      {/* ── "My Accounts Summary" registrar filter ───────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          View
        </span>
        <button
          type="button"
          disabled={navigating}
          onClick={() => navigate(fromLocal, toLocal, false)}
          className={chip(!mine)}
        >
          All registrations
        </button>
        <button
          type="button"
          disabled={navigating}
          onClick={() => navigate(fromLocal, toLocal, true)}
          className={chip(mine)}
        >
          My Accounts Summary
        </button>
        {mine && (
          <span className="text-[11px] text-muted-foreground">
            Showing only bills registered by{' '}
            <span className="text-foreground">{userLabel}</span>
          </span>
        )}
      </div>
    </div>
  );
}
