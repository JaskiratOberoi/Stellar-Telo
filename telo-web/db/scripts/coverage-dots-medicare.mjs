/*
 * coverage-dots-medicare.mjs — READ-ONLY coverage analysis of the 3-sheet
 * DOTS MEDICARE NEW.xlsx against rate list 139 (MEDICARE MRP RATE LIST).
 *
 * Sheets:
 *   TEST            → tbl_med_test_master / tbl_med_test_rates_with_pcc_type
 *   PROFILES        → tbl_med_test_profile_master / tbl_med_profile_rates_with_pcc_types
 *   MASTER PROFILES → tbl_med_master_profile_master / tbl_med_master_profile_rates_with_pcc_types
 *
 * Match: exact TestCode (case-insensitive trim). Reports per-sheet:
 *   - rows in Excel
 *   - rows whose TestCode exists in the corresponding master
 *   - rows whose master entry has an ACTIVE row in rate list 139
 *   - of those, how many already have MCC_Price == current rate-list Price
 *   - of those, how many would need updating (price differs)
 *   - rows whose TestCode is NOT in the master at all (need creating)
 *
 * Reads /tmp/dots_medicare_items.json (extracted by the Python step).
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

const { sheets } = JSON.parse(
  fs.readFileSync('/tmp/dots_medicare_items.json', 'utf8'),
);

// Master-profile master table name discovered via probe: tbl_med_test_master_profile_master
// (NOT tbl_med_master_profile_master). Columns: id, Master_Profile_Code,
// Master_Profile_Name, CT, MRP, IsActive.

// ── Pre-pull master indices ─────────────────────────────────────────
async function loadMasterIndex(query, codeKey = 'code') {
  const r = await pool.request().query(query);
  const byCode = new Map();
  for (const row of r.recordset) {
    const c = (row[codeKey] ?? '').trim().toLowerCase();
    if (!c) continue;
    byCode.set(c, row);
  }
  return byCode;
}

const tests = await loadMasterIndex(`
  SELECT id, TestCode AS code, Testname AS name, MRP AS mrp, IsActive AS active
  FROM dbo.tbl_med_test_master
`);
const profiles = await loadMasterIndex(`
  SELECT id, Profile_Code AS code, Profile_Name AS name, MRP AS mrp, IsActive AS active
  FROM dbo.tbl_med_test_profile_master
`);
const masterProfiles = await loadMasterIndex(`
  SELECT id, Master_Profile_Code AS code, Master_Profile_Name AS name,
         MRP AS mrp, IsActive AS active
  FROM dbo.tbl_med_test_master_profile_master
`);

console.log(
  `Masters loaded:  tests=${tests.size}  profiles=${profiles.size}  masterProfiles=${masterProfiles.size}\n`,
);

// ── Pre-pull rate list 139 membership + current Price ───────────────
const testRates = new Map();
for (const r of (await pool.request().input('id', sql.Int, RATE_TYPE_ID).query(`
  SELECT TestCode AS mid, Price FROM dbo.tbl_med_test_rates_with_pcc_type
  WHERE RateTypeId = @id AND IsActive = 1
`)).recordset) testRates.set(r.mid, r.Price);

const profileRates = new Map();
for (const r of (await pool.request().input('id', sql.Int, RATE_TYPE_ID).query(`
  SELECT profilecode AS mid, Price FROM dbo.tbl_med_profile_rates_with_pcc_types
  WHERE RateTypeId = @id AND IsActive = 1
`)).recordset) profileRates.set(r.mid, r.Price);

const masterProfileRates = new Map();
for (const r of (await pool.request().input('id', sql.Int, RATE_TYPE_ID).query(`
  SELECT master_profile_code AS mid, Price FROM dbo.tbl_med_master_profile_rates_with_pcc_types
  WHERE RateTypeId = @id AND IsActive = 1
`)).recordset) masterProfileRates.set(r.mid, r.Price);

console.log(
  `Rate list 139:   tests=${testRates.size}  profiles=${profileRates.size}  masterProfiles=${masterProfileRates.size}\n`,
);

// ── Per-sheet analysis ─────────────────────────────────────────────
function analyseSheet(sheetName, items, masterIdx, rateIdx, kind) {
  const total = items.length;
  let inMaster = 0;
  let inMasterInactive = 0;
  let inRateList = 0;
  let priceAlready = 0;
  let priceDiffers = 0;
  let mccPriceBlank = 0;
  const notInMaster = [];
  const priceMismatch = [];
  const allRows = []; // every row enriched with DB state for the xlsx dump

  for (const it of items) {
    const code = (it.testCode ?? '').trim().toLowerCase();
    if (!code) continue;
    const m = masterIdx.get(code);
    const out = {
      sheet: sheetName,
      kind,
      excelTestCode: it.testCode,
      excelName: it.name,
      excelMrp: it.mrp,
      excelMccPrice: it.mccPrice,
      masterId: m?.id ?? null,
      masterActive: m?.active ?? null,
      masterName: m?.name ?? null,
      masterMrp: m?.mrp ?? null,
      currentRateListPrice: null,
      delta: null,
      status: '',
    };
    if (!m) {
      out.status = 'not-in-master';
      notInMaster.push(it);
      allRows.push(out);
      continue;
    }
    inMaster++;
    if (!m.active) inMasterInactive++;
    const curPrice = rateIdx.get(m.id) ?? null;
    out.currentRateListPrice = curPrice;
    if (curPrice == null) {
      out.status = 'not-in-rate-list';
      allRows.push(out);
      continue;
    }
    inRateList++;
    const target = it.mccPrice;
    if (target == null || target === 0) {
      out.status = 'excel-blank-or-zero';
      mccPriceBlank++;
      allRows.push(out);
      continue;
    }
    out.delta = target - curPrice;
    if (curPrice === target) {
      out.status = 'already-correct';
      priceAlready++;
    } else {
      out.status = 'would-update';
      priceDiffers++;
      priceMismatch.push({ ...it, masterId: m.id, masterName: m.name, currentPrice: curPrice });
    }
    allRows.push(out);
  }
  return { sheetName, total, inMaster, inMasterInactive, inRateList, priceAlready, priceDiffers, mccPriceBlank, notInMaster, priceMismatch, allRows };
}

const reports = {
  TEST:            analyseSheet('TEST',            sheets.TEST,            tests,          testRates,         'test'),
  PROFILES:        analyseSheet('PROFILES',        sheets.PROFILES,        profiles,       profileRates,      'profile'),
  'MASTER PROFILES': analyseSheet('MASTER PROFILES', sheets['MASTER PROFILES'], masterProfiles, masterProfileRates, 'masterProfile'),
};

console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('                       COVERAGE — DOTS MEDICARE NEW.xlsx → rate list 139');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

for (const [name, r] of Object.entries(reports)) {
  const pct = (n) => r.total > 0 ? `${(n / r.total * 100).toFixed(1)}%` : '0.0%';
  console.log(`── ${name} (${r.total} rows)`);
  console.log(`     in master (TestCode matches)      : ${String(r.inMaster).padStart(5)}  (${pct(r.inMaster)})`);
  if (r.inMasterInactive > 0)
    console.log(`        └─ of which inactive            : ${String(r.inMasterInactive).padStart(5)}`);
  console.log(`     in rate list 139                  : ${String(r.inRateList).padStart(5)}  (${pct(r.inRateList)})`);
  console.log(`     price already correct             : ${String(r.priceAlready).padStart(5)}  (${pct(r.priceAlready)})`);
  console.log(`     price differs (would update)      : ${String(r.priceDiffers).padStart(5)}  (${pct(r.priceDiffers)})`);
  console.log(`     Excel MCC_Price 0/blank (skip)    : ${String(r.mccPriceBlank).padStart(5)}`);
  console.log(`     NOT in master (need creating)     : ${String(r.notInMaster.length).padStart(5)}  (${pct(r.notInMaster.length)})`);
  console.log('');
}

// Totals across all 3 sheets
const totals = {
  total: 0, inMaster: 0, inRateList: 0, priceAlready: 0, priceDiffers: 0, mccBlank: 0, notInMaster: 0,
};
for (const r of Object.values(reports)) {
  totals.total += r.total;
  totals.inMaster += r.inMaster;
  totals.inRateList += r.inRateList;
  totals.priceAlready += r.priceAlready;
  totals.priceDiffers += r.priceDiffers;
  totals.mccBlank += r.mccPriceBlank;
  totals.notInMaster += r.notInMaster.length;
}
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log(`  Grand totals across all 3 sheets — ${totals.total} Excel rows`);
console.log('══════════════════════════════════════════════════════════════════════════════');
const pct = (n) => totals.total > 0 ? `${(n / totals.total * 100).toFixed(1)}%` : '0.0%';
console.log(`  in master         : ${totals.inMaster.toString().padStart(5)}  (${pct(totals.inMaster)})`);
console.log(`  in rate list 139  : ${totals.inRateList.toString().padStart(5)}  (${pct(totals.inRateList)})`);
console.log(`  price already OK  : ${totals.priceAlready.toString().padStart(5)}  (${pct(totals.priceAlready)})`);
console.log(`  would update      : ${totals.priceDiffers.toString().padStart(5)}  (${pct(totals.priceDiffers)})`);
console.log(`  MCC_Price blank   : ${totals.mccBlank.toString().padStart(5)}`);
console.log(`  NOT in master     : ${totals.notInMaster.toString().padStart(5)}  (${pct(totals.notInMaster)})`);

fs.writeFileSync('/tmp/dots_medicare_coverage.json', JSON.stringify(reports, null, 2));
console.log('\nFull per-row report → /tmp/dots_medicare_coverage.json');

await pool.close();
