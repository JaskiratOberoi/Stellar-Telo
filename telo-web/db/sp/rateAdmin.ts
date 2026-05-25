import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface SetRateResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  price: number | null;
}

export async function setRate(
  rateTypeId: number,
  testMasterId: number,
  price: number,
): Promise<SetRateResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('rateTypeId', sql.Int, rateTypeId)
      .input('testMasterId', sql.Int, testMasterId)
      .input('price', sql.Int, price)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        price: number | null;
      }>('dbo.usp_telo_set_rate');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      price: row?.price ?? null,
    };
  });
}

export interface CreateRateListResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  rateTypeId: number | null;
  seededCount: number;
}

export async function createRateList(
  name: string,
  userId: number,
): Promise<CreateRateListResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('name', sql.NVarChar(50), name)
      .input('userId', sql.Int, userId)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        rate_type_id: number | null;
        seeded_count: number;
      }>('dbo.usp_telo_create_rate_list');
    const row = r.recordset[0];
    return {
      ok: row?.ok === true,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      rateTypeId: row?.rate_type_id ?? null,
      seededCount: row?.seeded_count ?? 0,
    };
  });
}
