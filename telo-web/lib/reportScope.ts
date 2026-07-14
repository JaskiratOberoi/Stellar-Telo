import 'server-only';
import { lisUsertypeToTeloRole } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { fetchMccUnitsByIds } from '@/db/read/mccUnits';
import { getSampleHeaders } from '@/db/read/sampleHeader';
import type { TeloUser } from '@/types/auth';

/**
 * Report-visibility scoping for the Reporting tab.
 *
 * The Reporting feature (worksheet result reports) is NOT scoped inside its
 * queries — the client-code / business-unit filters come from the operator, so
 * an unrestricted caller can see every client's patient reports. That's fine
 * for super_admin / admin, but the `client_reporting` role (and any future
 * client-facing role granted `report:view`) must only ever see/print the
 * reports of the client code(s) assigned to that user.
 *
 * Enforcement lives here and is applied at BOTH ends:
 *   - list/search: `filterRowsByReportScope` drops out-of-scope rows.
 *   - a single SID (preview iframe, PDF, bulk PDF): `canAccessSidReport`
 *     verifies the SID's client_code before anything is rendered/streamed.
 */

/** Roles that legitimately see EVERY client's reports (no per-client scoping). */
function isUnrestrictedReporter(user: TeloUser): boolean {
  const role = user.teloRole ?? lisUsertypeToTeloRole(user.usertypeId);
  return role === 'super_admin' || role === 'admin';
}

const norm = (c: string | null | undefined) => (c ?? '').trim().toUpperCase();

/**
 * The set of client codes (MCCUnitCode, upper-cased) a user may see reports for.
 * `null` = unrestricted (super_admin / admin). For everyone else it is their
 * assigned MCC scope resolved to client codes; an empty set means "sees nothing".
 */
export async function reportClientCodeScope(
  user: TeloUser,
): Promise<Set<string> | null> {
  if (isUnrestrictedReporter(user)) return null;
  const scope = await getMccScope(user.uid);
  if (scope.length === 0) return new Set();
  const units = await fetchMccUnitsByIds(scope);
  return new Set(units.map((u) => norm(u.code)).filter(Boolean));
}

/** Drop rows whose client_code is not in the allowed set (no-op when null). */
export function filterRowsByReportScope<T extends { client_code: string | null }>(
  rows: T[],
  allowed: Set<string> | null,
): T[] {
  if (allowed === null) return rows;
  return rows.filter((r) => allowed.has(norm(r.client_code)));
}

/**
 * Whether `user` may open/print the report for `sid`. Unrestricted roles always
 * may; otherwise EVERY worksheet row for that exact SID must belong to an
 * in-scope client code (an unknown SID or one outside scope → denied). This
 * closes direct-URL access to the preview iframe and the PDF routes, not just
 * the search list.
 */
export async function canAccessSidReport(
  user: TeloUser,
  sid: string,
): Promise<boolean> {
  const allowed = await reportClientCodeScope(user);
  if (allowed === null) return true;
  if (allowed.size === 0) return false;
  const target = sid.trim();
  if (!target) return false;
  // One exact-match header read — NOT the worksheet SP, whose leading-wildcard
  // SID filter over an unbounded window was a full samples-table scan per call.
  const rows = await getSampleHeaders(target);
  if (rows.length === 0) return false;
  return rows.every((r) => allowed.has(norm(r.client_code)));
}
