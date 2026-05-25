'use server';

import { currentUser } from '@/auth/session';
import { getMccScope } from '@/auth/scope';
import {
  listOrders,
  listRegistrations,
  listSampleAccessions,
  listPendingAccessions,
  type OrderSummary,
  type RegistrationSummary,
  type SampleAccessionSummary,
  type PendingAccession,
} from '@/db/read/orders';

export type OrdersView = 'bills' | 'registrations' | 'samples';

export interface RecentFeed {
  view: OrdersView;
  bills: OrderSummary[];
  registrations: RegistrationSummary[];
  samples: SampleAccessionSummary[];
  scopeCount: number;
  fetchedAt: string;
}

const EMPTY = (view: OrdersView): RecentFeed => ({
  view,
  bills: [],
  registrations: [],
  samples: [],
  scopeCount: 0,
  fetchedAt: new Date().toISOString(),
});

/**
 * Scope-aware recent-activity feed. The "Orders" page renders this; the
 * default view is `registrations` because the LIS produces thousands of
 * registrations/samples a day vs only a handful of bills — it's where
 * "live" actually happens.
 */
export async function getRecentOrders(
  view: OrdersView = 'registrations',
  limit = 100,
): Promise<RecentFeed> {
  const user = await currentUser();
  if (!user) return EMPTY(view);
  const scope = await getMccScope(user.uid);

  const [bills, registrations, samples] = await Promise.all([
    view === 'bills' ? listOrders(scope, limit) : Promise.resolve([]),
    view === 'registrations'
      ? listRegistrations(scope, limit)
      : Promise.resolve([]),
    view === 'samples'
      ? listSampleAccessions(scope, limit)
      : Promise.resolve([]),
  ]);

  return {
    view,
    bills,
    registrations,
    samples,
    scopeCount: scope.length,
    fetchedAt: new Date().toISOString(),
  };
}

export interface PendingAccessionsFeed {
  orders: PendingAccession[];
  scopeCount: number;
  fetchedAt: string;
}

/**
 * Telo orders still awaiting Sample IDs — the "New order" worklist. Scope-aware.
 */
export async function getPendingAccessions(): Promise<PendingAccessionsFeed> {
  const user = await currentUser();
  if (!user) {
    return { orders: [], scopeCount: 0, fetchedAt: new Date().toISOString() };
  }
  const scope = await getMccScope(user.uid);
  const orders = await listPendingAccessions(scope);
  return {
    orders,
    scopeCount: scope.length,
    fetchedAt: new Date().toISOString(),
  };
}
