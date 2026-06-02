import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import type { TeloRole } from '@/types/auth';

const TELO_ROLES: ReadonlySet<TeloRole> = new Set([
  'super_admin',
  'admin',
  'billing',
  'technician',
  'viewer',
]);

function toRole(value: string | null): TeloRole | null {
  if (!value) return null;
  return TELO_ROLES.has(value as TeloRole) ? (value as TeloRole) : null;
}

/**
 * Whether a user is "MRP only" — hides the B2B Orders tab. Reads
 * telo_account.mrp_only (false when no row, or if the column isn't deployed
 * yet). Resilient: any read failure resolves to false (the user simply sees
 * the B2B tab), never throws into a page render.
 */
export async function fetchMrpOnly(userId: number): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  try {
    return await withRetry(async () => {
      const pool = await getPool();
      const r = await pool
        .request()
        .input('uid', sql.Int, userId)
        .query<{ mrpOnly: boolean }>(
          `SELECT CAST(ISNULL(mrp_only, 0) AS BIT) AS mrpOnly
           FROM dbo.telo_account WHERE user_id = @uid`,
        );
      return !!r.recordset[0]?.mrpOnly;
    });
  } catch {
    return false;
  }
}

/** Telo role for one user (used by the auth flow). null if no row. */
export async function fetchTeloRole(userId: number): Promise<TeloRole | null> {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('uid', sql.Int, userId)
      .query<{ role: string }>(
        `SELECT role FROM dbo.tbl_telo_user_role WHERE user_id = @uid`,
      );
    return toRole(r.recordset[0]?.role ?? null);
  });
}

export interface TeloUserRow {
  id: number;
  username: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  /** Raw `tbl_med_user_master.IsActive` — the LIS login gate. */
  isActive: boolean;
  /** Telo login allowed. For Telo-managed accounts this is
   *  `telo_account.telo_active`; for native LIS users it mirrors `isActive`. */
  teloActive: boolean;
  /** LIS login allowed. For Telo-managed accounts this is
   *  `telo_account.lis_access`; for native LIS users it mirrors `isActive`. */
  lisAccess: boolean;
  /** True when a `dbo.telo_account` row exists — i.e. Telo manages this
   *  account's LIS/Telo gates and the LIS-access toggle applies. */
  hasTeloAccount: boolean;
  /** `telo_account.mrp_only` — when true the B2B Orders tab is hidden for this
   *  user (false for native LIS users / no row). */
  mrpOnly: boolean;
  lisUsertypeId: number | null;
  lisUsertypeName: string | null;
  teloRole: TeloRole | null;
  assignedAt: string | null;
  /** True if `tbl_med_user_master.createdby` starts with `'telo:'` — Telo
   *  is the only writer that uses that prefix (see
   *  `usp_telo_admin_create_user`). LIS-created rows never carry it. */
  createdByTelo: boolean;
}

/** Admin panel listing — LIS users joined to their Telo role assignment. */
export async function listTeloUsers(): Promise<TeloUserRow[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool.request().query<{
      id: number;
      username: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      isActive: boolean;
      teloActive: boolean;
      lisAccess: boolean;
      hasTeloAccount: number; // 0/1 from CASE
      mrpOnly: boolean;
      lisUsertypeId: number | null;
      lisUsertypeName: string | null;
      teloRole: string | null;
      assignedAt: Date | null;
      createdByTelo: number; // 0/1 from CASE
    }>(`
      SELECT u.id, u.Username AS username,
             u.firstname AS firstName, u.lastname AS lastName,
             u.Email AS email, u.IsActive AS isActive,
             -- Telo-managed accounts carry their own gates; native LIS users
             -- mirror IsActive so the UI can treat both uniformly.
             CAST(ISNULL(ta.telo_active, u.IsActive) AS BIT) AS teloActive,
             CAST(ISNULL(ta.lis_access, u.IsActive) AS BIT)  AS lisAccess,
             CASE WHEN ta.user_id IS NOT NULL THEN 1 ELSE 0 END AS hasTeloAccount,
             CAST(ISNULL(ta.mrp_only, 0) AS BIT) AS mrpOnly,
             u.usertypeid AS lisUsertypeId,
             ut.Name AS lisUsertypeName,
             r.role AS teloRole,
             r.assigned_at AS assignedAt,
             CASE WHEN u.createdby LIKE 'telo:%' THEN 1 ELSE 0 END AS createdByTelo
      FROM dbo.tbl_med_user_master u
      LEFT JOIN dbo.tbl_med_usertypes ut ON ut.id = u.usertypeid
      LEFT JOIN dbo.tbl_telo_user_role r ON r.user_id = u.id
      LEFT JOIN dbo.telo_account ta ON ta.user_id = u.id
      -- All LIS users — so the Telo admin can assign roles to existing
      -- Clients/Sub Clients/etc. Telo-roled users surface first; the
      -- client-side filter handles the rest of the ~3.5k list.
      ORDER BY
        CASE WHEN r.role IS NULL THEN 1 ELSE 0 END,
        u.IsActive DESC,
        u.Username
    `);
    return r.recordset.map((x) => ({
      id: x.id,
      username: (x.username ?? '').trim(),
      firstName: x.firstName?.trim() ?? null,
      lastName: x.lastName?.trim() ?? null,
      email: x.email?.trim() ?? null,
      isActive: !!x.isActive,
      teloActive: !!x.teloActive,
      lisAccess: !!x.lisAccess,
      hasTeloAccount: Number(x.hasTeloAccount) === 1,
      mrpOnly: !!x.mrpOnly,
      lisUsertypeId: x.lisUsertypeId,
      lisUsertypeName: x.lisUsertypeName?.trim() ?? null,
      teloRole: toRole(x.teloRole),
      assignedAt: x.assignedAt ? x.assignedAt.toISOString() : null,
      createdByTelo: Number(x.createdByTelo) === 1,
    }));
  });
}

export interface LisUsertype {
  id: number;
  name: string;
}

/** Active LIS user types for the onboarding form dropdown. */
export async function fetchLisUsertypes(): Promise<LisUsertype[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .query<{ id: number; name: string | null }>(
        `SELECT id, Name AS name FROM dbo.tbl_med_usertypes
         WHERE IsActive = 1 ORDER BY Name`,
      );
    return r.recordset.map((x) => ({ id: x.id, name: (x.name ?? '').trim() }));
  });
}
