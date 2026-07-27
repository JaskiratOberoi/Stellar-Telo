'use server';

import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import {
  listOrders,
  listRegistrations,
  listSampleAccessions,
  listPendingAccessions,
  listPendingRegistrations,
  type OrderSummary,
  type RegistrationSummary,
  type SampleAccessionSummary,
  type PendingAccession,
  type PendingRegistration,
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
  /** True when the caller has bill:view — gates ₹ display on the worklist. */
  canViewBill: boolean;
  fetchedAt: string;
}

/**
 * Telo orders still awaiting Sample IDs — the "New order" worklist. Scope-aware.
 *
 * `canViewBill` is returned alongside the feed so the client list can hide the
 * Amount column without a second round-trip. Per-order `total` is zeroed
 * server-side for technicians (no `bill:view`) — the value never leaves the
 * server even if a custom client tries to read it from the JSON payload.
 */
export async function getPendingAccessions(
  /** 'new' (default) excludes B2B orders; 'b2b' lists only B2B orders. */
  kind: 'new' | 'b2b' = 'new',
): Promise<PendingAccessionsFeed> {
  const user = await currentUser();
  if (!user) {
    return {
      orders: [],
      scopeCount: 0,
      canViewBill: false,
      fetchedAt: new Date().toISOString(),
    };
  }
  const scope = await getMccScope(user.uid);
  const canViewBill = hasCapability(user.caps, 'bill:view');
  const rows = await listPendingAccessions(scope, kind);
  const orders = canViewBill
    ? rows
    : rows.map((o) => ({ ...o, total: 0, balance: 0 }));
  return {
    orders,
    scopeCount: scope.length,
    canViewBill,
    fetchedAt: new Date().toISOString(),
  };
}

export interface PendingRegistrationsFeed {
  samples: PendingRegistration[];
  scopeCount: number;
  fetchedAt: string;
}

/**
 * Samples whose barcode is allotted but which the LIS has not yet registered
 * ("Sample Sent"). These are invisible on the worksheet until the lab receives
 * them — this is the queue that makes that wait visible instead of silent.
 * Scope-aware; carries no monetary fields, so no bill:view gating is needed.
 */
export async function getPendingRegistrations(
  /** 'new' (default) excludes B2B orders; 'b2b' lists only B2B orders. */
  kind: 'new' | 'b2b' = 'new',
): Promise<PendingRegistrationsFeed> {
  const user = await currentUser();
  if (!user) {
    return { samples: [], scopeCount: 0, fetchedAt: new Date().toISOString() };
  }
  const scope = await getMccScope(user.uid);
  const samples = await listPendingRegistrations(scope, kind);
  return {
    samples,
    scopeCount: scope.length,
    fetchedAt: new Date().toISOString(),
  };
}
