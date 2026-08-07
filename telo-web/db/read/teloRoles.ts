import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { cached, redis } from '@/lib/cache';
import type { Capability, TeloRole } from '@/types/auth';
import { isCapability } from '@/lib/capabilities';
import {
  ROLE_CAPS,
  LIS_TO_TELO_ROLE_MAP,
} from '@/auth/rbac-defaults';

const ROLES_KEY = 'telo:roles:v1';
const CAPS_KEY = 'telo:role-caps:v1';
const MAP_KEY = 'telo:lis-usertype-role:v1';
const TTL = 300;

export interface TeloRoleRow {
  roleKey: TeloRole;
  label: string;
  description: string | null;
  isActive: boolean;
  isBuiltin: boolean;
  userCount: number;
}

async function loadRolesUncached(): Promise<TeloRoleRow[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool.request().query<{
      role_key: string;
      label: string;
      description: string | null;
      is_active: boolean;
      is_builtin: boolean;
      user_count: number;
    }>(`
      SELECT r.role_key, r.label, r.description, r.is_active, r.is_builtin,
             (SELECT COUNT(*) FROM dbo.tbl_telo_user_role u WHERE u.role = r.role_key) AS user_count
      FROM dbo.telo_role r
      ORDER BY r.is_builtin DESC, r.label
    `);
    return r.recordset.map((x) => ({
      roleKey: x.role_key,
      label: x.label,
      description: x.description,
      isActive: !!x.is_active,
      isBuiltin: !!x.is_builtin,
      userCount: Number(x.user_count) || 0,
    }));
  });
}

async function loadCapsUncached(): Promise<Record<string, Capability[]>> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool.request().query<{
      role_key: string;
      capability: string;
    }>(`
      SELECT role_key, capability FROM dbo.telo_role_capability
      ORDER BY role_key, capability
    `);
    const out: Record<string, Capability[]> = {};
    for (const row of r.recordset) {
      if (!isCapability(row.capability)) continue;
      (out[row.role_key] ??= []).push(row.capability);
    }
    return out;
  });
}

async function loadMapUncached(): Promise<Record<number, TeloRole>> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool.request().query<{
      lis_usertype_id: number;
      telo_role_key: string;
    }>(`SELECT lis_usertype_id, telo_role_key FROM dbo.telo_lis_usertype_role`);
    const out: Record<number, TeloRole> = {};
    for (const row of r.recordset) {
      out[row.lis_usertype_id] = row.telo_role_key;
    }
    return out;
  });
}

/** Active + inactive Telo roles (for Admin hub). Falls back to ROLE_CAPS keys. */
export async function fetchTeloRoles(): Promise<TeloRoleRow[]> {
  try {
    const rows = await cached(ROLES_KEY, TTL, loadRolesUncached);
    if (rows.length > 0) return rows;
  } catch {
    /* fall through */
  }
  return Object.keys(ROLE_CAPS).map((k) => ({
    roleKey: k,
    label: k,
    description: null,
    isActive: true,
    isBuiltin: true,
    userCount: 0,
  }));
}

/** role_key → capabilities. Empty/missing → ROLE_CAPS fallback. */
export async function fetchRoleCapsMap(): Promise<Record<string, Capability[]>> {
  try {
    const map = await cached(CAPS_KEY, TTL, loadCapsUncached);
    if (Object.keys(map).length > 0) return map;
  } catch {
    /* fall through */
  }
  const out: Record<string, Capability[]> = {};
  for (const [k, v] of Object.entries(ROLE_CAPS)) out[k] = [...v];
  return out;
}

export async function fetchLisUsertypeRoleMap(): Promise<Record<number, TeloRole>> {
  try {
    const map = await cached(MAP_KEY, TTL, loadMapUncached);
    if (Object.keys(map).length > 0) return map;
  } catch {
    /* fall through */
  }
  return { ...LIS_TO_TELO_ROLE_MAP };
}

export async function invalidateTeloRoleCaches(): Promise<void> {
  try {
    await redis().del(ROLES_KEY, CAPS_KEY, MAP_KEY);
  } catch {
    /* best-effort */
  }
}

/** Caps for one role (DB first, then code fallback). */
export async function resolveCapsForRole(role: TeloRole): Promise<Capability[]> {
  const map = await fetchRoleCapsMap();
  if (map[role]?.length) return [...map[role]];
  return [...(ROLE_CAPS[role] ?? ROLE_CAPS.viewer)];
}

export async function resolveLisUsertypeToTeloRole(
  lisUsertypeId: number | null | undefined,
): Promise<TeloRole> {
  if (lisUsertypeId == null) return 'viewer';
  const map = await fetchLisUsertypeRoleMap();
  return map[lisUsertypeId] ?? LIS_TO_TELO_ROLE_MAP[lisUsertypeId] ?? 'viewer';
}

/**
 * Users affected by a Telo role change: explicit assignment OR LIS-default
 * map with no override (for Redis session-version cache bust).
 */
export async function listUserIdsForRole(roleKey: string): Promise<number[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('role', sql.NVarChar(40), roleKey)
      .query<{ user_id: number }>(`
        SELECT user_id FROM dbo.tbl_telo_user_role WHERE role = @role
        UNION
        SELECT u.id
        FROM dbo.tbl_med_user_master u
        INNER JOIN dbo.telo_lis_usertype_role m
          ON m.lis_usertype_id = u.usertypeid AND m.telo_role_key = @role
        WHERE NOT EXISTS (
          SELECT 1 FROM dbo.tbl_telo_user_role tr WHERE tr.user_id = u.id
        )
      `);
    return r.recordset.map((x) => x.user_id);
  });
}

/** Implicit-role users for one LIS usertype (no tbl_telo_user_role row). */
export async function listImplicitUserIdsForLisType(
  lisUsertypeId: number,
): Promise<number[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('ut', sql.Int, lisUsertypeId)
      .query<{ user_id: number }>(`
        SELECT u.id AS user_id
        FROM dbo.tbl_med_user_master u
        WHERE u.usertypeid = @ut
          AND NOT EXISTS (
            SELECT 1 FROM dbo.tbl_telo_user_role tr WHERE tr.user_id = u.id
          )
      `);
    return r.recordset.map((x) => x.user_id);
  });
}
