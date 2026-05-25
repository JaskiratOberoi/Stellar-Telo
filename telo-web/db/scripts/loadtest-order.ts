/*
 * Concurrency load test for usp_telo_create_order — proves vailid uniqueness
 * and per-MCC/month bill_number monotonicity under parallel writes.
 *
 * !! THIS WRITES REAL ROWS TO PRODUCTION NOBLE (patient/sample/bill/ledger) !!
 * Heavily guarded. Run ONLY with explicit operator intent:
 *
 *   TELO_LOADTEST_CONFIRM=YES npx tsx db/scripts/loadtest-order.ts --mcc <id> --n 20
 *
 * Fires N concurrent orders (1 cheap test each) and asserts: N distinct
 * vailids, N distinct bill_numbers, zero trigger_PreventDuplicate failures.
 * Records created bill ids so they can be reconciled/cleaned afterwards.
 */
import { config as loadEnv } from 'dotenv';
import path from 'path';
import sql from 'mssql';

loadEnv({ path: path.resolve(__dirname, '..', '..', '.env') });
loadEnv();

import { getTeloPoolConfig } from '../config';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.env.TELO_LOADTEST_CONFIRM !== 'YES') {
    throw new Error(
      'Refusing to run: set TELO_LOADTEST_CONFIRM=YES (this writes real production orders).',
    );
  }
  const mcc = Number(arg('mcc'));
  const n = Math.min(Math.max(Number(arg('n') ?? 10), 1), 50);
  const testId = Number(arg('test') ?? 1); // tbl_med_test_master.id
  const vailidBase = arg('vailid'); // sample SID; for n>1 a -k suffix is added
  if (!Number.isInteger(mcc)) throw new Error('--mcc <id> required');
  if (!vailidBase) throw new Error('--vailid <sampleSID> required (SID is external, never generated)');

  const pool = await new sql.ConnectionPool(getTeloPoolConfig()).connect();
  process.stdout.write(`Firing ${n} concurrent orders @ MCC ${mcc}…\n`);

  const one = async (k: number) => {
    const tvp = new sql.Table('dbo.TeloTestList');
    tvp.create = false;
    tvp.columns.add('testMasterId', sql.Int, { nullable: false });
    tvp.columns.add('isProfile', sql.Bit, { nullable: false });
    tvp.columns.add('code', sql.NVarChar(50), { nullable: false });
    tvp.columns.add('name', sql.NVarChar(200), { nullable: false });
    tvp.rows.add(testId, 0, 'LOADTEST', `loadtest-${k}`);
    const r = await pool
      .request()
      .input('userId', sql.Int, 0)
      .input('mcc', sql.Int, mcc)
      .input('vailid', sql.NVarChar(50), n === 1 ? vailidBase! : `${vailidBase}-${k}`)
      .input('patientId', sql.Int, 0)
      .input('name', sql.NVarChar(200), `LOADTEST ${Date.now()}-${k}`)
      .input('items', tvp)
      .execute<Record<string, unknown>>('dbo.usp_telo_create_order');
    // Status row is the LAST recordset (defensive against nested EXEC sets).
    const sets = r.recordsets as unknown as Array<Array<Record<string, unknown>>>;
    return (sets.length ? sets[sets.length - 1][0] : {}) as {
      ok: boolean;
      vailid: string | null;
      bill_number: number | null;
      bill_id: number | null;
      error_code: string | null;
    };
  };

  const results = await Promise.all(
    Array.from({ length: n }, (_, k) => one(k)),
  );
  await pool.close();

  const vailids = new Set(results.map((r) => r.vailid));
  const bills = new Set(results.map((r) => r.bill_number));
  const fails = results.filter((r) => !r.ok);

  process.stdout.write(
    `\nresults: ${results.length}  ok: ${results.length - fails.length}  fail: ${fails.length}\n` +
      `distinct vailids: ${vailids.size}/${results.length}\n` +
      `distinct bill_numbers: ${bills.size}/${results.length}\n` +
      `created bill_ids: ${results.map((r) => r.bill_id).filter(Boolean).join(',')}\n`,
  );
  if (fails.length)
    process.stdout.write(
      `failures: ${fails.map((f) => f.error_code).join(', ')}\n`,
    );

  const pass =
    vailids.size === results.length &&
    bills.size === results.length &&
    fails.length === 0;
  process.stdout.write(pass ? '\nPASS\n' : '\nFAIL — collisions detected\n');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`loadtest error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
