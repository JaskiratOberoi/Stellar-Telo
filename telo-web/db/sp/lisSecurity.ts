import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import type { LisAuthBits } from '@/db/read/lisSecurity';

export interface SpResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
}

export async function adminUpsertUsertype(input: {
  id?: number | null;
  name: string;
  description?: string | null;
  isActive: boolean;
  force?: boolean;
  actor: number;
}): Promise<SpResult & { id: number | null }> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('id', sql.Int, input.id && input.id > 0 ? input.id : null)
      .input('name', sql.NVarChar(100), input.name)
      .input('description', sql.NVarChar(400), input.description ?? null)
      .input('isActive', sql.Bit, input.isActive ? 1 : 0)
      .input('force', sql.Bit, input.force ? 1 : 0)
      .input('actor', sql.Int, input.actor)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        id: number | null;
      }>('dbo.usp_telo_admin_upsert_usertype');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      id: row?.id ?? null,
    };
  });
}

export async function adminSetUsertypeSecurity(input: {
  usertype: number;
  menuIds: number[];
  authBits: LisAuthBits;
  actor: number;
}): Promise<SpResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('usertype', sql.Int, input.usertype)
      .input('menuIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(input.menuIds))
      .input('authBitsJson', sql.NVarChar(sql.MAX), JSON.stringify(input.authBits))
      .input('actor', sql.Int, input.actor)
      .execute<{ ok: boolean; error_code: string | null; message: string | null }>(
        'dbo.usp_telo_admin_set_usertype_security',
      );
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
    };
  });
}
