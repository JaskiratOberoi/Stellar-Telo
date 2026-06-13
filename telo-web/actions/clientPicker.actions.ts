'use server';

import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import {
  fetchScopedMccUnits,
  searchMccUnits,
  type ScopedMcc,
} from '@/db/read/mccUnits';

/**
 * Scoped client (MCC) search for the Sales / Client-Accounts pickers. Always
 * filtered to what the caller may view:
 *  - Unrestricted (Super Admin / Admin, scope > 1000) → search the full active
 *    MCC list.
 *  - Scoped users → only their in-scope centres (in-memory filter; the set is
 *    small). Clients with a single centre never reach the picker (the index
 *    page redirects them straight to their own ledger).
 *
 * Read-only. Returns at most 20 matches.
 */
export async function searchClientsInScope(query: string): Promise<ScopedMcc[]> {
  const user = await requireSession();
  if (
    !hasCapability(user.caps, 'account:view') &&
    !hasCapability(user.caps, 'sales:view')
  ) {
    return [];
  }
  const scope = await getMccScope(user.uid);
  if (scope.length === 0) return [];
  const q = (query ?? '').trim();

  if (scope.length > 1000) {
    return searchMccUnits(q, { limit: 20 });
  }

  const units = await fetchScopedMccUnits(scope, scope);
  const needle = q.toLowerCase();
  const filtered = needle
    ? units.filter(
        (u) =>
          u.code.toLowerCase().includes(needle) ||
          (u.name ?? '').toLowerCase().includes(needle),
      )
    : units;
  return filtered.slice(0, 20);
}
