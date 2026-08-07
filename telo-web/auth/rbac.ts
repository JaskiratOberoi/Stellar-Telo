import type { AuthRow, Capability, TeloRole } from '@/types/auth';
import {
  ROLE_CAPS,
  LIS_TO_TELO_ROLE_MAP,
} from '@/auth/rbac-defaults';

export { ROLE_CAPS, LIS_TO_TELO_ROLE_MAP };

/**
 * Telo capabilities are role-based. The role itself comes from:
 *
 * 1. **Explicit assignment** (`tbl_telo_user_role`) — Admin panel.
 * 2. **Implicit** — derived from LIS `usertypeid` via `telo_lis_usertype_role`
 *    (seeded from the historic map; editable in Admin → Roles).
 *
 * Capability grants live in `telo_role_capability` (editable). The constants
 * in rbac-defaults.ts are seed + emergency fallback only.
 *
 * Sync helpers below use the in-code fallbacks (safe for client components).
 * Server auth uses the async resolvers that read Redis/DB.
 */

/** Sync fallback — prefer `resolveCapsForRole` on the server. */
export function deriveCapsForRole(role: TeloRole): Capability[] {
  return [...(ROLE_CAPS[role] ?? ROLE_CAPS.viewer)];
}

/** Sync fallback — prefer `resolveLisUsertypeToTeloRole` on the server. */
export function lisUsertypeToTeloRole(
  lisUsertypeId: number | null | undefined,
): TeloRole {
  if (lisUsertypeId == null) return 'viewer';
  return LIS_TO_TELO_ROLE_MAP[lisUsertypeId] ?? 'viewer';
}

/** Sync fallback using in-code map/caps (JWT minting uses the async path). */
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
