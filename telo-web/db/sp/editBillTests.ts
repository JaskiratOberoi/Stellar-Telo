import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/** One LIS test/profile/master line in the new set. itemKind: 0=test,1=profile,2=master. */
export interface EditTestItem {
  testMasterId: number;
  itemKind: 0 | 1 | 2;
  code: string;
  name: string;
}

/** One Telo custom line (billed, not LIS-performed) in the new set. */
export interface EditCustomLine {
  customTestId: number;
  code: string;
  name: string;
  unitAmount: number;
  qty: number;
  requiresMrd?: boolean;
}

export interface EditBillTestsInput {
  billId: number;
  userId: number;
  /** LIS tests/profiles/masters in the NEW set (may be empty for custom-only). */
  items: EditTestItem[];
  /** Custom lines in the NEW set (may be empty). */
  customLines: EditCustomLine[];
  mrdText?: string | null;
}

export interface EditBillTestsResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  balance: number | null;
}

function buildTestListTvp(items: EditTestItem[]): sql.Table {
  const t = new sql.Table('dbo.TeloTestList');
  t.columns.add('testMasterId', sql.Int, { nullable: false });
  t.columns.add('itemKind', sql.TinyInt, { nullable: false });
  t.columns.add('code', sql.NVarChar(50), { nullable: false });
  t.columns.add('name', sql.NVarChar(200), { nullable: false });
  const seen = new Set<string>();
  for (const i of items) {
    const key = `${i.testMasterId}:${i.itemKind}`;
    if (seen.has(key)) continue; // PK is (testMasterId, itemKind)
    seen.add(key);
    t.rows.add(
      Math.round(Number(i.testMasterId) || 0),
      Number(i.itemKind) || 0,
      (i.code ?? '').slice(0, 50) || String(i.testMasterId),
      (i.name ?? '').slice(0, 200) || (i.code ?? String(i.testMasterId)),
    );
  }
  return t;
}

function buildCustomLineTvp(lines: EditCustomLine[]): sql.Table {
  const t = new sql.Table('dbo.TeloCustomLine');
  t.columns.add('customTestId', sql.Int, { nullable: false });
  t.columns.add('code', sql.NVarChar(50), { nullable: false });
  t.columns.add('name', sql.NVarChar(200), { nullable: false });
  t.columns.add('unitAmount', sql.Int, { nullable: false });
  t.columns.add('qty', sql.Int, { nullable: false });
  t.columns.add('requiresMrd', sql.Bit, { nullable: false });
  // Collapse duplicates of the same custom test into one line, summing qty.
  const byId = new Map<number, EditCustomLine>();
  for (const l of lines) {
    const qty = Math.max(1, Math.round(Number(l.qty) || 1));
    const prev = byId.get(l.customTestId);
    if (prev) prev.qty += qty;
    else byId.set(l.customTestId, { ...l, qty });
  }
  for (const l of byId.values()) {
    t.rows.add(
      Math.round(Number(l.customTestId) || 0),
      (l.code ?? '').slice(0, 50) || String(l.customTestId),
      (l.name ?? '').slice(0, 200) || (l.code ?? String(l.customTestId)),
      Math.max(0, Math.round(Number(l.unitAmount) || 0)),
      Math.max(1, Math.round(Number(l.qty) || 1)),
      l.requiresMrd ? 1 : 0,
    );
  }
  return t;
}

/**
 * Replace the test set of an existing (sample-less) Telo bill — thin wrapper over
 * dbo.usp_telo_edit_bill_tests. The SP re-resolves rates and rebuilds the ordered
 * tests + billing lines + custom lines, then recomputes amount/Balance.
 */
export async function editBillTests(
  input: EditBillTestsInput,
): Promise<EditBillTestsResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('billId', sql.Int, input.billId)
      .input('userId', sql.Int, input.userId)
      .input('items', buildTestListTvp(input.items ?? []))
      .input('customLines', buildCustomLineTvp(input.customLines ?? []))
      .input('mrdText', sql.NVarChar(200), input.mrdText ?? null)
      .execute<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        balance: number | null;
      }>('dbo.usp_telo_edit_bill_tests');
    const row = r.recordset[0];
    return {
      ok: !!row?.ok,
      errorCode: row?.error_code ?? null,
      message: row?.message ?? null,
      balance: row?.balance ?? null,
    };
  });
}
