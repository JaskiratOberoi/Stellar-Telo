import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { cached } from '@/lib/cache';

export interface RateListSummary {
  id: number;
  name: string;
  isActive: boolean;
}

export interface RateRow {
  testMasterId: number;
  code: string;
  name: string;
  price: number | null;
  isActive: boolean;
}

/** All rate lists (tbl_med_test_rate_types). ~110 rows — cached 5 min. */
export function listRateTypes(): Promise<RateListSummary[]> {
  return cached('telo:ratelists:v1', 300, async () =>
    withRetry(async () => {
      const pool = await getPool();
      const r = await pool.request().query<{
        id: number;
        name: string | null;
        isActive: boolean;
      }>(`
        SELECT id, Rate AS name, IsActive AS isActive
        FROM dbo.tbl_med_test_rate_types
        ORDER BY Rate
      `);
      return r.recordset.map((x) => ({
        id: x.id,
        name: (x.name ?? `Rate #${x.id}`).trim(),
        isActive: x.isActive === true,
      }));
    }),
  );
}

export async function getRateTypeName(id: number): Promise<string | null> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('id', sql.Int, id)
      .query<{ name: string | null }>(
        'SELECT Rate AS name FROM dbo.tbl_med_test_rate_types WHERE id = @id',
      );
    return r.recordset[0]?.name?.trim() ?? null;
  });
}

/**
 * Effective rates for a rate list: every active test in the catalog with the
 * price set for this RateTypeId (NULL where the list has no row for it yet).
 * ~1.8k rows — loaded once, filtered in-memory on the client (catalog pattern).
 */
export async function getRateListRates(rateTypeId: number): Promise<RateRow[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('rt', sql.Int, rateTypeId)
      .query<{
        testMasterId: number;
        code: string | null;
        name: string | null;
        price: number | null;
        isActive: boolean | null;
      }>(`
        SELECT t.id AS testMasterId, t.TestCode AS code, t.Testname AS name,
               r.Price AS price, r.IsActive AS isActive
        FROM dbo.tbl_med_test_master t
        OUTER APPLY (
          SELECT TOP 1 rr.Price, rr.IsActive
          FROM dbo.tbl_med_test_rates_with_pcc_type rr
          WHERE rr.TestCode = t.id AND rr.RateTypeId = @rt
          ORDER BY rr.IsActive DESC, rr.id DESC
        ) r
        WHERE t.IsActive = 1
        ORDER BY t.Testname
      `);
    return r.recordset.map((x) => ({
      testMasterId: x.testMasterId,
      code: (x.code ?? '').trim(),
      name: (x.name ?? '').trim(),
      price: x.price ?? null,
      isActive: x.isActive === true,
    }));
  });
}
