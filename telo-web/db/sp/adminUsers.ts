import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import type { TeloRole } from '@/types/auth';

export interface AdminSpResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
}

export interface CreateUserResult extends AdminSpResult {
  userId: number | null;
}

export interface CreateUserInput {
  username: string;
  password: string;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  lisUsertypeId: number;
  teloRole: TeloRole;
  actor: number;
}

export async function adminCreateUser(
  input: CreateUserInput,
): Promise<CreateUserResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('username', sql.NVarChar(50), input.username)
      .input('password', sql.NVarChar(50), input.password)
      .input('firstName', sql.NVarChar(100), input.firstName)
      .input('lastName', sql.NVarChar(100), input.lastName ?? null)
      .input('email', sql.NVarChar(100), input.email ?? null)
      .input('lisUsertypeId', sql.Int, input.lisUsertypeId)
      .input('teloRole', sql.NVarChar(20), input.teloRole)
      .input('actor', sql.Int, input.actor)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        user_id: number | null;
      }>('dbo.usp_telo_admin_create_user');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      userId: row?.user_id ?? null,
    };
  });
}

export async function adminSetRole(args: {
  userId: number;
  teloRole: TeloRole;
  actor: number;
}): Promise<AdminSpResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('userId', sql.Int, args.userId)
      .input('teloRole', sql.NVarChar(20), args.teloRole)
      .input('actor', sql.Int, args.actor)
      .execute<{ ok: boolean; error_code: string | null; message: string | null }>(
        'dbo.usp_telo_admin_set_role',
      );
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
    };
  });
}

export async function adminResetPassword(args: {
  userId: number;
  newPassword: string;
  actor: number;
}): Promise<AdminSpResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('userId', sql.Int, args.userId)
      .input('newPassword', sql.NVarChar(50), args.newPassword)
      .input('actor', sql.Int, args.actor)
      .execute<{ ok: boolean; error_code: string | null; message: string | null }>(
        'dbo.usp_telo_admin_reset_password',
      );
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
    };
  });
}

export async function adminSetActive(args: {
  userId: number;
  active: boolean;
  actor: number;
}): Promise<AdminSpResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('userId', sql.Int, args.userId)
      .input('active', sql.Bit, args.active ? 1 : 0)
      .input('actor', sql.Int, args.actor)
      .execute<{ ok: boolean; error_code: string | null; message: string | null }>(
        'dbo.usp_telo_admin_set_active',
      );
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
    };
  });
}

/**
 * Grants/revokes LIS login for a Telo-managed account by flipping
 * telo_account.lis_access (the SP re-derives tbl_med_user_master.IsActive, the
 * bit the legacy LIS actually checks). Does NOT affect the user's Telo login.
 */
export async function adminSetLisAccess(args: {
  userId: number;
  enabled: boolean;
  actor: number;
}): Promise<AdminSpResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('userId', sql.Int, args.userId)
      .input('enabled', sql.Bit, args.enabled ? 1 : 0)
      .input('actor', sql.Int, args.actor)
      .execute<{ ok: boolean; error_code: string | null; message: string | null }>(
        'dbo.usp_telo_admin_set_lis_access',
      );
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
    };
  });
}

/** Sets the per-account "MRP only" flag (hides the B2B Orders tab). */
export async function adminSetMrpOnly(args: {
  userId: number;
  enabled: boolean;
  actor: number;
}): Promise<AdminSpResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('userId', sql.Int, args.userId)
      .input('enabled', sql.Bit, args.enabled ? 1 : 0)
      .input('actor', sql.Int, args.actor)
      .execute<{ ok: boolean; error_code: string | null; message: string | null }>(
        'dbo.usp_telo_admin_set_mrp_only',
      );
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
    };
  });
}
