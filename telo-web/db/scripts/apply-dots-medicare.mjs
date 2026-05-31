/*
 * apply-dots-medicare.mjs — WRITES updates to all 3 rate-list tables for
 * MEDICARE MRP RATE LIST (RateTypeId=139) using the DOTS MEDICARE NEW.xlsx
 * coverage data extracted earlier.
 *
 * Policy (per the user's explicit instruction):
 *   target = MRP   if Excel.MRP is set and > 0
 *          = MCC_Price   otherwise
 *   if target is null / 0 / negative → SKIP (don't wipe a valid price)
 *   if target == current DB Price → no-op
 *   else → UPDATE
 *
 * All updates run in ONE transaction with full rollback on any failure.
 * No master rows touched. No new rows inserted (every row already exists in
 * list 139 per the coverage analysis — 100% coverage).
 *
 * Reports per-row before/after to /tmp/dots_medicare_updates_applied.json.
 */

import sql from 'mssql';
import net from 'net';
import fs from 'fs';

const RATE_TYPE_ID = 139;

function splitServer(raw) {
  const m = /^(.+?)[,:](\d+)$/.exec(raw.trim());
  return m
    ? { host: m[1].trim(), port: Number(m[2]) }
    : { host: raw.trim(), port: undefined };
}

const { host, port } = splitServer(process.env.TELO_SQL_SERVER);
const pool = await new sql.ConnectionPool({
  server: host, port,
  database: process.env.TELO_SQL_DATABASE,
  user: process.env.TELO_SQL_USER, password: process.env.TELO_SQL_PASSWORD,
  options: {
    encrypt: process.env.TELO_SQL_ENCRYPT !== 'false',
    trustServerCertificate: process.env.TELO_SQL_TRUST_CERT === 'true',
    serverName: net.isIP(host) ? 'sqlserver' : undefined,
    useUTC: false,
  },
}).connect();

const cov = JSON.parse(fs.readFileSync('/tmp/dots_medicare_coverage.json', 'utf8'));

// Map sheet → { table, fkColumn, kind }
const TABLE_FOR_SHEET = {
  TEST:              { table: 'tbl_med_test_rates_with_pcc_type',              fk: 'TestCode',           kind: 'test' },
  PROFILES:          { table: 'tbl_med_profile_rates_with_pcc_types',          fk: 'profilecode',        kind: 'profile' },
  'MASTER PROFILES': { table: 'tbl_med_master_profile_rates_with_pcc_types',   fk: 'master_profile_code', kind: 'masterProfile' },
};

// ── Build update plan ─────────────────────────────────────────────────
const plan = [];
const noop = [];
const skipBlank = [];
const skipConflict = [];

for (const [sheetName, sheetRep] of Object.entries(cov)) {
  const tbl = TABLE_FOR_SHEET[sheetName];
  if (!tbl) { console.warn(`No table mapping for sheet ${sheetName}`); continue; }

  // Group by masterId — if two Excel rows point at the same master with
  // different target prices, flag as conflict and skip (defensive).
  const byMaster = new Map();
  for (const r of sheetRep.allRows) {
    if (r.status === 'not-in-master') continue;
    if (r.masterId == null) continue;
    const mrp = r.excelMrp;
    const mcc = r.excelMccPrice;
    // Policy: prefer MRP when set and > 0; else fall back to MCC_Price.
    let target;
    if (mrp != null && mrp > 0) target = mrp;
    else if (mcc != null && mcc > 0) target = mcc;
    else target = null;

    if (!byMaster.has(r.masterId)) {
      byMaster.set(r.masterId, {
        sheet: sheetName, kind: tbl.kind, table: tbl.table, fk: tbl.fk,
        masterId: r.masterId, masterName: r.masterName,
        excelTestCode: r.excelTestCode,
        currentPrice: r.currentRateListPrice,
        target,
        excelRows: [],
      });
    }
    byMaster.get(r.masterId).excelRows.push({
      code: r.excelTestCode, name: r.excelName, mrp, mcc, target,
    });
  }

  for (const t of byMaster.values()) {
    const targets = [...new Set(t.excelRows.map((x) => x.target).filter((v) => v != null && v > 0))];
    if (targets.length === 0) {
      skipBlank.push({ ...t, reason: 'no-valid-target' });
      continue;
    }
    if (targets.length > 1) {
      skipConflict.push({ ...t, targets });
      continue;
    }
    const target = targets[0];
    t.target = target;
    if (t.currentPrice === target) {
      noop.push(t);
      continue;
    }
    plan.push({ ...t, oldPrice: t.currentPrice, newPrice: target });
  }
}

console.log('── Plan ─────────────────────────────────────────');
console.log(`  Updates to apply        : ${plan.length}`);
console.log(`  Already matching        : ${noop.length}`);
console.log(`  Skipped (blank target)  : ${skipBlank.length}`);
console.log(`  Skipped (conflict)      : ${skipConflict.length}`);
console.log('');

// ── Apply in one transaction ──────────────────────────────────────────
const tx = new sql.Transaction(pool);
await tx.begin();
let applied = 0;
const failures = [];
try {
  for (const p of plan) {
    const req = new sql.Request(tx);
    await req
      .input('id', sql.Int, RATE_TYPE_ID)
      .input('mid', sql.Int, p.masterId)
      .input('price', sql.Int, p.newPrice)
      .query(`
        UPDATE dbo.${p.table}
        SET Price = @price
        WHERE RateTypeId = @id
          AND ${p.fk} = @mid
          AND IsActive = 1
      `);
    applied++;
  }
  await tx.commit();
  console.log(`✓ Committed ${applied} updates in 1 transaction.\n`);
} catch (e) {
  await tx.rollback();
  console.error(`✗ ROLLED BACK after ${applied} statements:`, e.message);
  failures.push(e.message);
}

// ── Report ────────────────────────────────────────────────────────────
const counts = {
  TEST: 0, PROFILES: 0, 'MASTER PROFILES': 0,
};
for (const p of plan) counts[p.sheet]++;

console.log('── Counts by sheet ──');
for (const [k, v] of Object.entries(counts)) {
  console.log(`  ${k.padEnd(18)}  ${v}`);
}
console.log('');

console.log('── First 20 updates (sample) ──');
for (const p of plan.slice(0, 20)) {
  console.log(
    `  [${p.kind.padEnd(13)}] #${String(p.masterId).padStart(5)}  ${(p.excelTestCode || '').padEnd(14)}  "${(p.masterName || '').slice(0, 40).padEnd(40)}"  ₹${p.oldPrice ?? '?'} → ₹${p.newPrice}`,
  );
}
if (plan.length > 20) console.log(`  … ${plan.length - 20} more — see /tmp/dots_medicare_updates_applied.json`);

if (skipConflict.length > 0) {
  console.log('\n── Conflicts (NOT updated) ──');
  for (const c of skipConflict) {
    console.log(`  [${c.kind}] #${c.masterId} ${c.excelTestCode} — targets: ${c.targets.join(', ')}`);
  }
}

fs.writeFileSync(
  '/tmp/dots_medicare_updates_applied.json',
  JSON.stringify({ counts, plan, noop, skipBlank, skipConflict, failures }, null, 2),
);
console.log('\nFull audit → /tmp/dots_medicare_updates_applied.json');

await pool.close();
