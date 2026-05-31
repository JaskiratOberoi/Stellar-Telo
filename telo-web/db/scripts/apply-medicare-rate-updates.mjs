/*
 * apply-medicare-rate-updates.mjs — WRITES Price into rate list 139
 * (MEDICARE MRP RATE LIST) for the CONFIDENTLY-MATCHED Excel rows only.
 *
 * Reads /tmp/medicare_diff_report.json (produced by diff-medicare-rate-list.mjs).
 * Touches NO master rows, NO ambiguous rows, NO unmatched rows.
 *
 * Skip rules:
 *  - excelPrice <= 0 / null     → SKIP (Excel had a blank/zero — don't wipe)
 *  - currentPrice == excelPrice → no-op (counted)
 *  - multiple Excel rows map to the same master with conflicting prices
 *    → SKIP, log as conflict (operator decides)
 *
 * Reports plan first, then applies in one transaction. Per-row before/after
 * is written to /tmp/medicare_updates_applied.json.
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

const report = JSON.parse(
  fs.readFileSync('/tmp/medicare_diff_report.json', 'utf8'),
);
const covered = report.covered ?? [];
console.log(`Covered rows from diff: ${covered.length}\n`);

// ── Group covered rows by master (kind+id). Resolve Excel-side conflicts. ─
const byMaster = new Map(); // key = `${kind}:${id}` → { kind, id, code, name, excelRows: [...] }
for (const c of covered) {
  const m = c.matched[0]; // a "covered" entry has at least one matched master in list
  const key = `${m.kind}:${m.masterId}`;
  if (!byMaster.has(key)) {
    byMaster.set(key, {
      kind: m.kind,
      masterId: m.masterId,
      code: m.code,
      name: m.name,
      excelRows: [],
    });
  }
  byMaster.get(key).excelRows.push({
    name: c.excel.name,
    sub: c.excel.subcategory,
    price: c.excel.price,
    how: c.how,
  });
}
console.log(`Unique masters targeted: ${byMaster.size}\n`);

// ── Build plan ────────────────────────────────────────────────────────
const plan = [];
const skipZero = [];
const skipConflict = [];
const noop = [];

for (const t of byMaster.values()) {
  // Excel rows pointing here. Dedupe / resolve conflicts.
  const prices = t.excelRows
    .map((r) => r.price)
    .filter((p) => p != null && p > 0);
  const uniquePrices = [...new Set(prices)];
  if (uniquePrices.length === 0) {
    skipZero.push({ ...t, reason: 'all-excel-prices-blank-or-zero' });
    continue;
  }
  if (uniquePrices.length > 1) {
    skipConflict.push({
      ...t,
      excelPrices: prices,
    });
    continue;
  }
  const target = uniquePrices[0];

  // Read current Price from the rate-list table.
  const cur = t.kind === 'test'
    ? await pool.request()
        .input('id', sql.Int, RATE_TYPE_ID)
        .input('mid', sql.Int, t.masterId)
        .query(`
          SELECT TOP 1 id, Price FROM dbo.tbl_med_test_rates_with_pcc_type
          WHERE RateTypeId = @id AND TestCode = @mid AND IsActive = 1
        `)
    : await pool.request()
        .input('id', sql.Int, RATE_TYPE_ID)
        .input('mid', sql.Int, t.masterId)
        .query(`
          SELECT TOP 1 id, Price FROM dbo.tbl_med_profile_rates_with_pcc_types
          WHERE RateTypeId = @id AND profilecode = @mid AND IsActive = 1
        `);
  const row = cur.recordset[0];
  if (!row) {
    // Theoretically shouldn't happen (covered = in list), but be safe.
    skipConflict.push({ ...t, reason: 'no-active-row-in-list' });
    continue;
  }
  const oldPrice = row.Price;
  if (oldPrice === target) {
    noop.push({ ...t, price: target });
    continue;
  }
  plan.push({
    kind: t.kind,
    masterId: t.masterId,
    code: t.code,
    name: t.name,
    rowId: row.id,
    oldPrice,
    newPrice: target,
    excelRows: t.excelRows,
  });
}

console.log('── Plan ──────────────────────────────────────────────');
console.log(`  Updates to apply         : ${plan.length}`);
console.log(`  Already matching (no-op) : ${noop.length}`);
console.log(`  Skipped (Excel 0/blank)  : ${skipZero.length}`);
console.log(`  Skipped (conflict)       : ${skipConflict.length}`);
console.log('');

// ── Apply in one transaction ─────────────────────────────────────────
const tx = new sql.Transaction(pool);
await tx.begin();
let applied = 0;
const failures = [];
try {
  for (const p of plan) {
    const req = new sql.Request(tx);
    if (p.kind === 'test') {
      await req
        .input('id', sql.Int, p.rowId)
        .input('price', sql.Int, p.newPrice)
        .query(`
          UPDATE dbo.tbl_med_test_rates_with_pcc_type
          SET Price = @price
          WHERE id = @id
        `);
    } else {
      await req
        .input('id', sql.Int, p.rowId)
        .input('price', sql.Int, p.newPrice)
        .query(`
          UPDATE dbo.tbl_med_profile_rates_with_pcc_types
          SET Price = @price
          WHERE id = @id
        `);
    }
    applied++;
  }
  await tx.commit();
  console.log(`✓ Committed ${applied} updates in 1 transaction.\n`);
} catch (e) {
  await tx.rollback();
  console.error(`✗ ROLLED BACK — error after ${applied} statements:`, e.message);
  failures.push(e.message);
}

// ── Report ───────────────────────────────────────────────────────────
console.log('── Updates applied (top 50) ─────────────────────────');
for (const p of plan.slice(0, 50)) {
  console.log(
    `  [${String(p.kind).padEnd(7)}] #${String(p.masterId).padStart(4)} ${p.code.padEnd(10)}  "${p.name.slice(0, 45).padEnd(45)}"  ₹${p.oldPrice}  →  ₹${p.newPrice}`,
  );
}
if (plan.length > 50) console.log(`  … ${plan.length - 50} more (see JSON output)`);
console.log('');

if (skipConflict.length > 0) {
  console.log('── Conflicts (NOT updated) ──────────────────────────');
  for (const c of skipConflict) {
    console.log(
      `  #${c.masterId} ${c.code} "${c.name}" — excel prices: ${c.excelPrices?.join(', ') ?? c.reason}`,
    );
  }
}

fs.writeFileSync(
  '/tmp/medicare_updates_applied.json',
  JSON.stringify({ applied: plan, noop, skipZero, skipConflict, failures }, null, 2),
);
console.log('\nFull log → /tmp/medicare_updates_applied.json');

await pool.close();
