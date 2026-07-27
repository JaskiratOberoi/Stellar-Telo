'use server';

import { requireCapability } from '@/auth/guards';
import {
  listAuditLog,
  type AuditCategory,
  type AuditPage,
} from '@/db/read/auditLog';

const CATEGORIES: AuditCategory[] = [
  'all',
  'reports',
  'users',
  'auth',
  'orders',
  'payments',
  'samples',
];

/**
 * Audit-trail feed for the /audit tab. Super Admin only (`user:manage`) — the
 * trail exposes who did what across every client, so it carries the same gate
 * as the admin panel itself.
 */
export async function getAuditTrail(filters: {
  from?: string | null;
  to?: string | null;
  category?: string | null;
  actor?: string | null;
  q?: string | null;
  page?: number;
}): Promise<AuditPage> {
  await requireCapability('user:manage');
  const category = CATEGORIES.includes(filters.category as AuditCategory)
    ? (filters.category as AuditCategory)
    : 'all';
  return listAuditLog({
    from: filters.from ?? null,
    to: filters.to ?? null,
    category,
    actor: filters.actor ?? null,
    q: filters.q ?? null,
    page: filters.page ?? 1,
    pageSize: 50,
  });
}
