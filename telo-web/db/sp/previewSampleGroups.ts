import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import type { CartItem } from '@/domain/cart/cart.types';

export interface SampleGroup {
  sampleTypeId: number; // -1 for "Unspecified" (test master missing SampleId)
  sampleTypeName: string;
  csvCodes: string;
  csvNames: string;
  csvTestMasterIds: string;
  requiresSplit: boolean;
  itemCount: number;
}

/** Build the dbo.TeloTestList TVP. Identical shape to createOrder's builder
 *  but kept here so this read action stands alone. */
function buildTestListTvp(items: CartItem[]): sql.Table {
  const t = new sql.Table('dbo.TeloTestList');
  t.create = false;
  t.columns.add('testMasterId', sql.Int, { nullable: false });
  t.columns.add('itemKind', sql.TinyInt, { nullable: false });
  t.columns.add('code', sql.NVarChar(50), { nullable: false });
  t.columns.add('name', sql.NVarChar(200), { nullable: false });
  const seen = new Set<string>();
  for (const i of items) {
    // itemKind: 0 = test, 1 = profile, 2 = master profile
    const kind = i.kind === 'master' ? 2 : i.kind === 'profile' ? 1 : 0;
    const key = `${kind}:${i.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    t.rows.add(
      i.id,
      kind,
      (i.code ?? '').slice(0, 50) || String(i.id),
      (i.name ?? '').slice(0, 200) || (i.code ?? String(i.id)),
    );
  }
  return t;
}

/**
 * Calls dbo.usp_telo_preview_sample_groups for the New Order form.
 * Read-only. Returns one group per distinct sample type the order requires,
 * already including the codes/names the form should show next to each SID
 * input.
 */
export async function previewSampleGroups(
  items: CartItem[],
): Promise<SampleGroup[]> {
  if (items.length === 0) return [];
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('items', buildTestListTvp(items))
      .execute<{
        sampleTypeId: number;
        sampleTypeName: string;
        csvCodes: string | null;
        csvNames: string | null;
        csvTestMasterIds: string | null;
        requiresSplit: boolean;
        itemCount: number;
      }>('dbo.usp_telo_preview_sample_groups');
    return r.recordset.map((x) => ({
      sampleTypeId: x.sampleTypeId,
      sampleTypeName: x.sampleTypeName,
      csvCodes: x.csvCodes ?? '',
      csvNames: x.csvNames ?? '',
      csvTestMasterIds: x.csvTestMasterIds ?? '',
      requiresSplit: x.requiresSplit === true,
      itemCount: x.itemCount,
    }));
  });
}
