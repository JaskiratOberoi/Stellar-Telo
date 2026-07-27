'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDashboardStats } from '@/actions/stats.actions';
import type { DayStats } from '@/db/read/stats';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import { fmtIST, todayIST, addDaysIST } from '@/lib/datetime';
import { cn } from '@/lib/utils';

// Polling cadence — bumped 30s → 60s. Combined with visibility-gating below
// (no polls while the tab is hidden) and a 30s Redis memoization on the server,
// dashboard load on Noble drops to roughly: (active tabs) × (1 query / 60s) /
// (memo TTL) — i.e. effectively one query per minute regardless of audience.
const POLL_MS = 60_000;
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
// IST calendar day (see lib/datetime) — UTC dates put "Today" on the previous
// day between 00:00–05:30 IST.
const todayISO = () => todayIST();
const shiftISO = (iso: string, days: number) => addDaysIST(iso, days);

const STATUS_COLORS: Record<string, string> = {
  Authorized: 'bg-secondary/15 text-secondary',
  'In progress': 'bg-primary/15 text-primary',
  Tested: 'bg-foreground/10 text-foreground',
  Printed: 'bg-foreground/10 text-foreground',
};

export function DashboardLive({ initial }: { initial: DayStats }) {
  const [s, setS] = useState<DayStats>(initial);
  const [date, setDate] = useState<string>(initial.date);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const isToday = date === todayISO();

  const load = useCallback(async (d: string) => {
    const my = ++seq.current;
    setBusy(true);
    try {
      const next = await getDashboardStats(d);
      if (my === seq.current) setS(next);
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }, []);

  // Refetch when the selected date changes.
  useEffect(() => {
    if (date !== s.date) load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Live poll only for "today" — and only while the tab is actually visible.
  // Before this change, a stack of dashboards left open in background tabs
  // each fired one query / 30 s against Noble forever, even though no human
  // was looking at the numbers. Now: pause on hidden, refresh immediately on
  // becoming visible (so the user sees fresh data the instant they switch
  // back), and otherwise poll at POLL_MS.
  useEffect(() => {
    if (!live || !isToday) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id != null) return;
      id = setInterval(() => load(date), POLL_MS);
    };
    const stop = () => {
      if (id == null) return;
      clearInterval(id);
      id = null;
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load(date);
        start();
      } else {
        stop();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    if (document.visibilityState === 'visible') start();
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stop();
    };
  }, [live, isToday, date, load]);

  const maxRev = Math.max(1, ...s.trend.map((t) => t.revenue));

  return (
    <div className="stagger space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value || todayISO())}
            className="h-8 w-32 sm:w-40"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDate(todayISO())}
            disabled={isToday}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDate(shiftISO(todayISO(), -1))}
          >
            Yesterday
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDate(shiftISO(date, -1))}
          >
            ‹ Prev
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDate(shiftISO(date, 1))}
            disabled={isToday}
          >
            Next ›
          </Button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'inline-block h-2 w-2 rounded-full',
                isToday && live
                  ? 'animate-pulse bg-secondary'
                  : 'bg-muted-foreground/40',
              )}
            />
            {isToday ? (live ? 'Live' : 'Paused') : 'Snapshot'} ·{' '}
            {fmtIST(s.fetchedAt, 'time')} IST
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(date)}
            disabled={busy}
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
          {isToday && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLive((v) => !v)}
            >
              {live ? 'Pause' : 'Resume'}
            </Button>
          )}
        </div>
      </div>

      {/* KPI bento — revenue hero (2 cols) + three supporting tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {/* Hero: the day's revenue on the brand gradient. */}
        <div className="hover-lift relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-[hsl(var(--brand-2))] p-5 text-white shadow-glow-lg sm:col-span-2 lg:row-span-1">
          {/* soft radial highlight */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/15 blur-2xl"
          />
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
            Revenue
          </p>
          <p className="mt-2 animate-fade-in-up font-display text-4xl font-extrabold leading-none tracking-tight">
            {inr(s.revenue)}
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium backdrop-blur-sm">
            {s.bills} bill{s.bills === 1 ? '' : 's'}
          </p>
        </div>
        <KpiCard
          variant="light"
          className="hover-lift"
          label="Collected"
          value={inr(s.collected)}
        />
        <KpiCard
          variant="light"
          className="hover-lift"
          label="Outstanding"
          value={inr(s.outstanding)}
          hint={s.discount ? `${inr(s.discount)} discount` : undefined}
        />
        <KpiCard
          variant="light"
          className="hover-lift"
          label="Patients billed"
          value={s.patients.toLocaleString('en-IN')}
        />
      </div>

      {/* Secondary stats row */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard
          label="Registrations"
          value={s.registrations.toLocaleString('en-IN')}
          hint="samples registered"
        />
        {['Authorized', 'Printed', 'Tested'].map((st) => {
          const row = s.byStatus.find((b) => b.status === st);
          return (
            <KpiCard
              key={st}
              label={st}
              value={(row?.count ?? 0).toLocaleString('en-IN')}
            />
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Revenue trend bar chart */}
        <div className="card-sheen hover-lift rounded-2xl border border-foreground/5 bg-card p-4 shadow-card">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Revenue · 7 days ending {date}
          </p>
          <div className="flex h-32 items-end gap-2">
            {s.trend.map((t) => (
              <div
                key={t.date}
                className="flex flex-1 flex-col items-center gap-1"
                title={`${t.date}: ${inr(t.revenue)}`}
              >
                <div
                  className={cn(
                    'w-full rounded-t transition-all duration-300',
                    t.date === date
                      ? 'bg-primary shadow-lg shadow-primary/30'
                      : 'bg-primary/30',
                  )}
                  style={{
                    height: `${Math.max(2, (t.revenue / maxRev) * 100)}%`,
                  }}
                />
                <span className="text-[10px] text-muted-foreground">
                  {t.date.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Samples by status */}
        <div className="card-sheen hover-lift rounded-2xl border border-foreground/5 bg-card p-4 shadow-card">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Samples by status
          </p>
          {s.byStatus.length === 0 ? (
            <p className="text-sm text-muted-foreground">No samples.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {s.byStatus.map((b) => (
                <span
                  key={b.status}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm font-medium transition-colors duration-200',
                    STATUS_COLORS[b.status] ?? 'bg-foreground/10 text-foreground',
                  )}
                >
                  {b.status}:{' '}
                  <span className="font-bold">
                    {b.count.toLocaleString('en-IN')}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
