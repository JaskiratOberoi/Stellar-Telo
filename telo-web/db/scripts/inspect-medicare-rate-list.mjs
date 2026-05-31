/*
 * inspect-medicare-rate-list.mjs — READ-ONLY query.
 *
 * Hunts the Noble LIS for any rate list whose name or description matches
 * /medicare/i. Reports each match, the row counts in the per-test and
 * per-profile tables, and a few sample rate rows for context.
 *
 * Run from telo-web/:
 *   node db/scripts/inspect-medicare-rate-list.mjs
 *
 * Reads connection from telo-web/.env (TELO_SQL_*). Issues only SELECTs.
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
const cfg = {
  server: host,
  port,
  database: process.env.TELO_SQL_DATABASE,
  user: process.env.TELO_SQL_USER,
  password: process.env.TELO_SQL_PASSWORD,
  options: {
    encrypt: process.env.TELO_SQL_ENCRYPT !== 'false',
    trustServerCertificate: process.env.TELO_SQL_TRUST_CERT === 'true',
    serverName: net.isIP(host) ? 'sqlserver' : undefined,
    useUTC: false,
  },
};

const pool = await new sql.ConnectionPool(cfg).connect();
console.log(`Connected to ${host} / ${process.env.TELO_SQL_DATABASE}.\n`);

// 1. List all rate types — give the lay of the land first.
const allTypes = await pool.request().query(`
  SELECT id, Rate AS name, Description, IsActive
  FROM dbo.tbl_med_test_rate_types
  ORDER BY id
`);
console.log(`── All rate types (${allTypes.recordset.length} rows) ─────────────────`);
for (const r of allTypes.recordset) {
  console.log(
    `  id=${String(r.id).padStart(3)}  active=${r.IsActive}  name="${r.name ?? ''}"  desc="${r.Description ?? ''}"`,
  );
}
console.log('');

// 2. Find any rate type matching /medicare/i.
const medicare = await pool.request().query(`
  SELECT id, Rate AS name, Description, IsActive
  FROM dbo.tbl_med_test_rate_types
  WHERE Rate LIKE '%medicare%' OR Description LIKE '%medicare%'
  ORDER BY id
`);
console.log(`── Medicare matches in tbl_med_test_rate_types (${medicare.recordset.length}) ──`);
if (medicare.recordset.length === 0) {
  console.log('  (none)');
}
for (const r of medicare.recordset) {
  console.log(
    `  id=${r.id}  active=${r.IsActive}  name="${r.name}"  desc="${r.Description ?? ''}"`,
  );
  // Row counts per match.
  const testCount = await pool
    .request()
    .input('id', sql.Int, r.id)
    .query(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS active_n
       FROM dbo.tbl_med_test_rates_with_pcc_type
       WHERE RateTypeId = @id`,
    );
  const profCount = await pool
    .request()
    .input('id', sql.Int, r.id)
    .query(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS active_n
       FROM dbo.tbl_med_profile_rates_with_pcc_types
       WHERE RateTypeId = @id`,
    );
  console.log(
    `      tests  : total=${testCount.recordset[0].n}, active=${testCount.recordset[0].active_n}`,
  );
  console.log(
    `      profiles: total=${profCount.recordset[0].n}, active=${profCount.recordset[0].active_n}`,
  );

  // 3. Sample rows — first 10 active test rates with code + name + price.
  const sample = await pool
    .request()
    .input('id', sql.Int, r.id)
    .query(`
      SELECT TOP 10
        t.TestCode AS code,
        tm.Testname AS name,
        t.Price,
        tm.MRP AS mrp
      FROM dbo.tbl_med_test_rates_with_pcc_type t
      LEFT JOIN dbo.tbl_med_test_master tm ON tm.id = t.TestCode
      WHERE t.RateTypeId = @id AND t.IsActive = 1
      ORDER BY t.Price DESC
    `);
  console.log(`      sample (top 10 by Price):`);
  for (const x of sample.recordset) {
    console.log(
      `         ${String(x.code ?? '').padStart(6)}  ${String(x.name ?? '').slice(0, 40).padEnd(40)}  price=₹${x.Price}  mrp=₹${x.mrp ?? '—'}`,
    );
  }
  console.log('');
}

// 4. Also check tbl_med_mcc_unit_master for any MCC named "Medicare" (so the
// user knows we're not confusing rate list with a client account).
const medicareMccs = await pool.request().query(`
  SELECT id, MCCUnitCode AS code, MCCUnitName AS name, IsActive
  FROM dbo.tbl_med_mcc_unit_master
  WHERE MCCUnitCode LIKE '%medicare%' OR MCCUnitName LIKE '%medicare%'
  ORDER BY MCCUnitName
`);
console.log(`── Medicare matches in tbl_med_mcc_unit_master (${medicareMccs.recordset.length}) ──`);
if (medicareMccs.recordset.length === 0) {
  console.log('  (none)');
}
for (const r of medicareMccs.recordset) {
  console.log(
    `  id=${r.id}  active=${r.IsActive}  code="${r.code}"  name="${r.name}"`,
  );
}

await pool.close();
