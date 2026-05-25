'use server';

import { currentUser } from '@/auth/session';
import { getMccScope } from '@/auth/scope';
import { getStats, type DayStats } from '@/db/read/stats';

/** Scope-aware KPIs + 7-day trend for a date (default today). Polled client-side. */
export async function getDashboardStats(dateISO?: string): Promise<DayStats> {
  const user = await currentUser();
  const d = (dateISO ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (!user) {
    return {
      date: d, bills: 0, patients: 0, registrations: 0, revenue: 0,
      collected: 0, outstanding: 0, discount: 0, byStatus: [], trend: [],
      fetchedAt: new Date().toISOString(),
    };
  }
  const scope = await getMccScope(user.uid);
  return getStats(scope, dateISO);
}
