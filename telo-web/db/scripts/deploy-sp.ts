/**
 * Deploy Telo SQL artefacts (TVPs + usp_telo_* procs) against the Noble DB.
 * Port of Listec's scripts/deploy-sp.ts: GO-split batches, walk db/sql/*.sql
 * in lexical order (prefix 00_, 10_, 20_… when ordering matters), idempotent
 * CREATE OR ALTER. After deploy, smoke-tests usp_telo_resolve_rate if present.
 *
 * Usage:
 *   npm run deploy:sp                 # walk db/sql/
 *   npm run deploy:sp -- ./db/sql/30_usp_telo_resolve_rate.sql   # single file
 */
import { config as loadEnv } from 'dotenv';
import path from 'path';
import fs from 'fs';
import sql from 'mssql';

loadEnv({ path: path.resolve(__dirname, '..', '..', '.env') });
loadEnv();

import { getTeloPoolConfig } from '../config';

function splitBatches(script: string): string[] {
  return script
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

async function deployBatches(
  pool: sql.ConnectionPool,
  label: string,
  script: string,
): Promise<void> {
  const batches = splitBatches(script);
  if (batches.length === 0) {
    process.stdout.write(`  ${label}: no batches after GO split, skipping.\n`);
    return;
  }
  let i = 0;
  for (const batch of batches) {
    i++;
    process.stdout.write(
      `  ${label} batch ${i}/${batches.length} (${batch.length} chars)…\n`,
    );
    await pool.request().batch(batch);
  }
}

async function deployFile(pool: sql.ConnectionPool, abs: string): Promise<void> {
  if (!fs.existsSync(abs)) throw new Error(`SQL script not found: ${abs}`);
  await deployBatches(pool, path.basename(abs), fs.readFileSync(abs, 'utf8'));
}

async function deployDir(pool: sql.ConnectionPool, dir: string): Promise<number> {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`SQL directory not found: ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    process.stdout.write(`No *.sql files in ${dir}.\n`);
    return 0;
  }
  process.stdout.write(`Deploying ${files.length} script(s) from ${dir}:\n`);
  for (const f of files) await deployFile(pool, path.join(dir, f));
  return files.length;
}

async function smokeTest(pool: sql.ConnectionPool): Promise<void> {
  const exists = await pool
    .request()
    .query(
      "SELECT OBJECT_ID('dbo.usp_telo_resolve_rate') AS oid",
    );
  if (!exists.recordset[0]?.oid) {
    process.stdout.write('Smoke test: usp_telo_resolve_rate not deployed yet — skipped.\n');
    return;
  }
  process.stdout.write('Smoke-testing dbo.usp_telo_resolve_rate (test id=1)…\n');
  const r = await pool
    .request()
    .input('mcc', sql.Int, 1)
    .input('testMasterId', sql.Int, 1)
    .input('profileCode', sql.Int, null)
    .input('forBilling', sql.Bit, 0)
    .execute<Record<string, unknown>>('dbo.usp_telo_resolve_rate');
  process.stdout.write(
    `  resolved: ${JSON.stringify(r.recordset[0] ?? null)}\n`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const singleFile = argv.find((a) => !a.startsWith('-'));
  const dirPath = path.resolve(__dirname, '..', 'sql');

  const cfg = getTeloPoolConfig();
  process.stdout.write(
    `Connecting to ${cfg.server} / ${cfg.database} as ${cfg.user}…\n`,
  );
  const pool = await new sql.ConnectionPool(cfg).connect();
  try {
    if (singleFile) {
      await deployFile(pool, path.resolve(process.cwd(), singleFile));
    } else {
      await deployDir(pool, dirPath);
    }
    process.stdout.write('Deploy OK.\n');
    await smokeTest(pool);
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  process.stderr.write(
    `Deploy failed: ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(1);
});
