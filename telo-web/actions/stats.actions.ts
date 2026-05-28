'use server';

import { requireCapability } from '@/auth/guards';
import { getMccScope } from '@/auth/scope';
import { cached } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import { getStats, type DayStats } from '@/db/read/stats';

// Short Redis memoization so N concurrent dashboards in the same user's
// scope collapse to ~1 Noble query / 30s. Per-user key because scope can
// differ between users; the dashboard polls every 60s client-side, so a
// 30s TTL keeps numbers feeling live while still absorbing the herd.
const STATS_TTL_SECONDS = 30;

const EMPTY = (d: string): DayStats => ({
  date: d, bills: 0, patients: 0, registrations: 0, revenue: 0,
  collected: 0, cashCollected: 0, otherCollected: 0, refunded: 0,
  outstanding: 0, discount: 0, byStatus: [], trend: [],
  fetchedAt: new Date().toISOString(),
});

/**
 * Scope-aware KPIs + 7-day trend for a date (default today). Polled client-side.
 *
 * Gated by `dashboard:view` — technicians (and any future role that lacks the
 * cap) get an empty payload instead of revenue/collected/outstanding figures
 * even if they call the action directly. The dashboard page also redirects
 * such users away, but the action is the real enforcement point.
 */
export async function getDashboardStats(dateISO?: string): Promise<DayStats> {
  const d = (dateISO ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  let user;
  try {
    user = await requireCapability('dashboard:view');
  } catch (e) {
    if (e instanceof AppError) return EMPTY(d);
    throw e;
  }
  const scope = await getMccScope(user.uid);
  return cached(`telo:dash:${user.uid}:${d}`, STATS_TTL_SECONDS, () =>
    getStats(scope, dateISO),
  );
}
