import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface SpResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
}

export async function adminUpsertTeloRole(input: {
  roleKey: string;
  label: string;
  description?: string | null;
  isActive: boolean;
  actor: number;
}): Promise<SpResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('roleKey', sql.NVarChar(40), input.roleKey)
      .input('label', sql.NVarChar(100), input.label)
      .input('description', sql.NVarChar(400), input.description ?? null)
      .input('isActive', sql.Bit, input.isActive ? 1 : 0)
      .input('actor', sql.Int, input.actor)
      .execute<{ ok: boolean; error_code: string | null; message: string | null }>(
        'dbo.usp_telo_admin_upsert_telo_role',
      );
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
    };
  });
}

export async function adminSetTeloRoleCaps(input: {
  roleKey: string;
  caps: string[];
  actor: number;
}): Promise<SpResult & { bumped: number }> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('roleKey', sql.NVarChar(40), input.roleKey)
      .input('capsJson', sql.NVarChar(sql.MAX), JSON.stringify(input.caps))
      .input('actor', sql.Int, input.actor)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        bumped: number;
      }>('dbo.usp_telo_admin_set_telo_role_caps');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      bumped: Number(row?.bumped) || 0,
    };
  });
}

export async function adminSetLisUsertypeRole(input: {
  lisUsertypeId: number;
  teloRoleKey: string;
  actor: number;
}): Promise<SpResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('lisUsertypeId', sql.Int, input.lisUsertypeId)
      .input('teloRoleKey', sql.NVarChar(40), input.teloRoleKey)
      .input('actor', sql.Int, input.actor)
      .execute<{ ok: boolean; error_code: string | null; message: string | null }>(
        'dbo.usp_telo_admin_set_lis_usertype_role',
      );
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
    };
  });
}
