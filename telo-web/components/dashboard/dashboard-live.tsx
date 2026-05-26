'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDashboardStats } from '@/actions/stats.actions';
import type { DayStats } from '@/db/read/stats';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import { fmtIST } from '@/lib/datetime';
import { cn } from '@/lib/utils';

const POLL_MS = 30_000;
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const shiftISO = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const STATUS_COLORS: Record<string, string> = {
  Authorized: 'bg-secondary/15 text-secondary',
  'In progress': 'bg-primary/15 text-primary',
  Tested: 'bg-white/10 text-foreground',
  Printed: 'bg-white/10 text-foreground',
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

  // Live poll only for "today".
  useEffect(() => {
    if (!live || !isToday) return;
    const id = setInterval(() => load(date), POLL_MS);
    return () => clearInterval(id);
  }, [live, isToday, date, load]);

  const maxRev = Math.max(1, ...s.trend.map((t) => t.revenue));

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value || todayISO())}
            className="h-8 w-40"
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

      {/* KPI tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          variant="accent"
          label="Revenue"
          value={inr(s.revenue)}
          hint={`${s.bills} bill${s.bills === 1 ? '' : 's'}`}
        />
        <KpiCard
          variant="light"
          label="Collected"
          value={inr(s.collected)}
        />
        <KpiCard
          variant="light"
          label="Outstanding"
          value={inr(s.outstanding)}
          hint={s.discount ? `${inr(s.discount)} discount` : undefined}
        />
        <KpiCard
          variant="light"
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
        <div className="rounded-xl border border-white/5 bg-card p-4">
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
        <div className="rounded-xl border border-white/5 bg-card p-4">
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
                    STATUS_COLORS[b.status] ?? 'bg-white/10 text-foreground',
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
