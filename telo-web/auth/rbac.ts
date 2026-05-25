import type { AuthRow, Capability, TeloRole } from '@/types/auth';

/**
 * Telo capabilities — derived in two ways depending on whether a user has an
 * assigned Telo role (tbl_telo_user_role) or not:
 *
 * 1. **Role present**  → `ROLE_CAPS[role]` is the authoritative cap set.
 *    Tweak per-role permissions here and redeploy (per the platform
 *    decision: defaults in code, admin panel only assigns roles).
 * 2. **Role absent**   → fall back to the legacy LIS-derived mapping
 *    (`deriveLisCaps`) so existing logins continue working exactly as before.
 * 3. **Bootstrap**     → an LIS Super Admin (usertypeid=1) with no Telo role
 *    row is implicitly treated as Telo `super_admin`, so the Admin panel is
 *    always reachable. Once they get an explicit row, that wins.
 *
 * Deny-by-default within `ROLE_CAPS`: a role earns a capability only if listed.
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
    'rate:view',
    'rate:manage',
    'balance:view',
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
  ],
  technician: [
    // Only the New Order worklist — open existing orders to add SIDs.
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
  ],
};

/** Resolve caps for an explicitly-assigned Telo role. */
export function deriveCapsForRole(role: TeloRole): Capability[] {
  return [...ROLE_CAPS[role]];
}

/** Legacy LIS-derived capability set — used when no Telo role is assigned. */
function deriveLisCaps(row: AuthRow): Capability[] {
  const caps = new Set<Capability>();
  const t = row.usertype_id ?? -1;

  // tbl_med_usertypes ids
  const SUPER_ADMIN = 1;
  const ORDER_ROLES = new Set<number>([2, 7, 12]); // Client, Sub Client, CLIENT INVOICE
  const VIEW_ROLES = new Set<number>([2, 7, 8, 12]); // + CLIENT REPORTING

  if (t === SUPER_ADMIN) {
    return [...ROLE_CAPS.super_admin];
  }

  if (ORDER_ROLES.has(t)) {
    caps.add('order:create');
    caps.add('order:accession');
    caps.add('order:view');
    caps.add('patient:create');
    caps.add('payment:capture');
  }
  if (VIEW_ROLES.has(t)) {
    caps.add('bill:view');
    caps.add('balance:view');
    caps.add('order:view');
  }

  if (row.cap_discount && caps.has('order:create')) caps.add('order:discount');
  if (row.cap_patient_details) caps.add('patient:view');

  return [...caps];
}

/**
 * Main entry — picks the right derivation:
 *   teloRole assigned → ROLE_CAPS[role]
 *   otherwise, LIS Super Admin (usertypeid=1) → bootstrap super_admin
 *   otherwise, legacy LIS-derived caps.
 */
export function deriveCapabilities(
  row: AuthRow,
  teloRole: TeloRole | null,
): Capability[] {
  if (teloRole) return deriveCapsForRole(teloRole);
  if (row.usertype_id === 1) return deriveCapsForRole('super_admin');
  return deriveLisCaps(row);
}

export function hasCapability(caps: Capability[], needed: Capability): boolean {
  return caps.includes(needed);
}
