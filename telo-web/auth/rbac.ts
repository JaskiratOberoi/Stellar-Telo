import type { AuthRow, Capability, TeloRole } from '@/types/auth';

/**
 * Telo capabilities are role-based. The role itself comes from one of two
 * places:
 *
 * 1. **Explicit assignment** (`tbl_telo_user_role`) — set by a Telo Super
 *    Admin via the Admin panel. Highest precedence.
 * 2. **Implicit (derived from LIS usertypeid)** — every login that lacks an
 *    explicit row gets a Telo role derived in code from its
 *    `tbl_med_user_master.usertypeid` via `LIS_TO_TELO_ROLE_MAP` below.
 *    No DB writes; nothing in the LIS schema changes.
 *
 * Tweak the per-role permission set in `ROLE_CAPS` or the per-LIS-role
 * mapping in `LIS_TO_TELO_ROLE_MAP` and redeploy. The Admin panel still
 * lets you override on a per-user basis without code changes.
 */

export const ROLE_CAPS: Record<TeloRole, Capability[]> = {
  super_admin: [
    'user:manage',
    'order:create',
    'order:accession',
    'order:view',
    'order:discount',
    'patient:create',
    'patient:view',
    'bill:view',
    'payment:capture',
    'payment:refund',
    'rate:view',
    'rate:manage',
    'balance:view',
    'account:view',
    'sales:view',
    'dashboard:view',
    // Reporting is gated to super_admin only while the feature is finalised.
    // Widen by adding 'report:view' to other roles here.
    'report:view',
  ],
  admin: [
    // Everything super_admin has EXCEPT user:manage.
    'order:create',
    'order:accession',
    'order:view',
    'order:discount',
    'patient:create',
    'patient:view',
    'bill:view',
    'payment:capture',
    'rate:view',
    'rate:manage',
    'balance:view',
    'account:view',
    'sales:view',
    'dashboard:view',
  ],
  billing: [
    'order:create',
    'order:accession',
    'order:view',
    'order:discount',
    'patient:create',
    'patient:view',
    'bill:view',
    'payment:capture',
    'rate:view',
    'balance:view',
    'account:view',
    'sales:view',
    'dashboard:view',
  ],
  technician: [
    // Strictly the New Order worklist — open existing orders to add SIDs.
    // No dashboard:view → revenue KPIs are hidden and / lands on /orders/new.
    'order:accession',
    'order:view',
    'patient:view',
  ],
  viewer: [
    // Read-only across Dashboard / Orders / Balances / Rate lists.
    'order:view',
    'patient:view',
    'bill:view',
    'rate:view',
    'balance:view',
    'account:view',
    'sales:view',
    'dashboard:view',
  ],
};

/**
 * Map every LIS `tbl_med_usertypes.id` to its Telo role. IDs not listed
 * default to `'viewer'` — the safest fallback for an unknown LIS role.
 *
 * Source: `tbl_med_usertypes` snapshot. Numbers are the LIS `id`s.
 */
export const LIS_TO_TELO_ROLE_MAP: Record<number, TeloRole> = {
  1: 'super_admin', // Super Admin
  5: 'admin', // Admin
  26: 'admin', // Director
  28: 'admin', // BAS ADMIN
  32: 'admin', // SALES ADMIN
  2: 'billing', // Client
  7: 'billing', // Sub Client
  12: 'billing', // CLIENT INVOICE
  29: 'billing', // WALKIN CODES
  33: 'billing', // ENTRY
  4: 'technician', // Technician
  9: 'technician', // Molecular
  16: 'technician', // PHLEBOTMIST
  17: 'technician', // HISTO TECH
  18: 'technician', // AUTHORISED
  20: 'technician', // ACCESSIONING
  25: 'technician', // SPL MOLECULR
  30: 'technician', // TECH ONLY
  34: 'technician', // HLD ACCESSION
  // Everything else (Doctor, Sales, Reporting variants, Accounts, RSM, …)
  // → viewer by default. Override per-user from the Admin panel if needed.
};

/** Resolve caps for a given Telo role. */
export function deriveCapsForRole(role: TeloRole): Capability[] {
  return [...ROLE_CAPS[role]];
}

/** Derive a Telo role from an LIS usertypeid (always returns one). */
export function lisUsertypeToTeloRole(
  lisUsertypeId: number | null | undefined,
): TeloRole {
  if (lisUsertypeId == null) return 'viewer';
  return LIS_TO_TELO_ROLE_MAP[lisUsertypeId] ?? 'viewer';
}

/**
 * Main entry — explicit assignment wins; otherwise derive from LIS
 * usertypeid via the in-code map. AuthRow's per-user security bits are no
 * longer used for capability shaping — the role is the source of truth.
 */
export function deriveCapabilities(
  row: AuthRow,
  teloRole: TeloRole | null,
): Capability[] {
  const effective = teloRole ?? lisUsertypeToTeloRole(row.usertype_id);
  return deriveCapsForRole(effective);
}

export function hasCapability(caps: Capability[], needed: Capability): boolean {
  return caps.includes(needed);
}
