/*
 * verify-aep01.mjs — READ-ONLY check. Cross-checks every table that holds
 * a price for test AEP01 (AUTOIMMUNE ENCEPHALITIS PANEL, masterId=2215)
 * so we can see exactly where the update landed and what the LIS UI is
 * reading.
 */
import sql from 'mssql';
import net from 'net';

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

console.log('Looking up AEP01 — AUTOIMMUNE ENCEPHALITIS PANEL\n');

// 1. tbl_med_test_master — the test master itself. The edit screen in the LIS
//    UI is bound to THIS table. MRP here is the catalogue list price.
const master = await pool.request().query(`
  SELECT id, TestCode, Testname, Price_CT, MRP, IsActive
  FROM dbo.tbl_med_test_master
  WHERE TestCode = 'AEP01'
`);
console.log('── 1. tbl_med_test_master (what the "Add/Edit Test Master" screen edits)');
for (const r of master.recordset) {
  console.log(`   id=${r.id}  TestCode=${r.TestCode}  Testname="${r.Testname}"`);
  console.log(`   Price_CT=₹${r.Price_CT}  MRP=₹${r.MRP}  IsActive=${r.IsActive}`);
}
console.log('');

const masterId = master.recordset[0]?.id;

// 2. Every rate list this test appears in, with the price in each.
const rates = await pool.request().input('mid', sql.Int, masterId).query(`
  SELECT
    r.id AS rateRowId,
    r.RateTypeId,
    rt.Rate AS rateListName,
    r.Price,
    r.IsActive
  FROM dbo.tbl_med_test_rates_with_pcc_type r
  JOIN dbo.tbl_med_test_rate_types rt ON rt.id = r.RateTypeId
  WHERE r.TestCode = @mid AND rt.IsActive = 1
  ORDER BY rt.Rate
`);
console.log(`── 2. tbl_med_test_rates_with_pcc_type — per-rate-list rows for masterId=${masterId}`);
console.log(`   (showing only active rate lists — ${rates.recordset.length} rows)`);
for (const r of rates.recordset) {
  const marker = r.RateTypeId === 139 ? '  ← MEDICARE MRP RATE LIST (this is what I updated)' : '';
  console.log(
    `   RateTypeId=${String(r.RateTypeId).padStart(3)}  "${(r.rateListName ?? '').padEnd(28)}"  Price=₹${String(r.Price).padStart(6)}  rowId=${r.rateRowId}${marker}`,
  );
}
console.log('');

// 3. Specifically the MEDICARE row.
const medicare = await pool.request().input('mid', sql.Int, masterId).query(`
  SELECT r.id, r.Price, r.IsActive, r.RateTypeId,
         rt.Rate AS rateListName
  FROM dbo.tbl_med_test_rates_with_pcc_type r
  JOIN dbo.tbl_med_test_rate_types rt ON rt.id = r.RateTypeId
  WHERE r.TestCode = @mid AND r.RateTypeId = 139
`);
console.log('── 3. The MEDICARE row specifically (RateTypeId=139)');
for (const r of medicare.recordset) {
  console.log(`   rowId=${r.id}  Rate-list="${r.rateListName}"  Price=₹${r.Price}  IsActive=${r.IsActive}`);
}

await pool.close();
