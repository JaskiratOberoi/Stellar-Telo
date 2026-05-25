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
  isActive: boolean;
  lisUsertypeId: number | null;
  lisUsertypeName: string | null;
  teloRole: TeloRole | null;
  assignedAt: string | null;
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
      lisUsertypeId: number | null;
      lisUsertypeName: string | null;
      teloRole: string | null;
      assignedAt: Date | null;
    }>(`
      SELECT u.id, u.Username AS username,
             u.firstname AS firstName, u.lastname AS lastName,
             u.Email AS email, u.IsActive AS isActive,
             u.usertypeid AS lisUsertypeId,
             ut.Name AS lisUsertypeName,
             r.role AS teloRole,
             r.assigned_at AS assignedAt
      FROM dbo.tbl_med_user_master u
      LEFT JOIN dbo.tbl_med_usertypes ut ON ut.id = u.usertypeid
      LEFT JOIN dbo.tbl_telo_user_role r ON r.user_id = u.id
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
      lisUsertypeId: x.lisUsertypeId,
      lisUsertypeName: x.lisUsertypeName?.trim() ?? null,
      teloRole: toRole(x.teloRole),
      assignedAt: x.assignedAt ? x.assignedAt.toISOString() : null,
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
