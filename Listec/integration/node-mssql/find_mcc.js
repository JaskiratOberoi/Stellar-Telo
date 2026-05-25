const sql = require('mssql');
const net = require('net');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  server: process.env.LISTEC_SQL_SERVER.split(',')[0],
  port: parseInt(process.env.LISTEC_SQL_SERVER.split(',')[1] || '1433', 10),
  database: process.env.LISTEC_SQL_DATABASE,
  user: process.env.LISTEC_SQL_USER,
  password: process.env.LISTEC_SQL_PASSWORD,
  options: {
    encrypt: process.env.LISTEC_SQL_ENCRYPT === 'true',
    trustServerCertificate: process.env.LISTEC_SQL_TRUST_CERT === 'true',
    serverName: net.isIP(process.env.LISTEC_SQL_SERVER.split(',')[0]) ? 'sqlserver' : undefined,
  },
  connectionTimeout: 15000,
  requestTimeout: 60000,
};

async function main() {
  const pool = await sql.connect(config);

  const m = await pool.request().query(
    `SELECT TOP 20 id, MCCUnitCode, MCCUnitName
     FROM tbl_med_mcc_unit_master
     WHERE MCCUnitCode LIKE '%0610%' OR MCCUnitName LIKE '%KAMLA%'`);
  console.log('\n--- MCC search HLD0610 / KAMLA ---');
  console.table(m.recordset);

  // Probe master account row directly using mcc id 5637 (from cheque suffix)
  const masterById = await pool.request().query(
    `SELECT u.id, u.MCCUnitCode, u.MCCUnitName, am.currentbalance, am.totaldeposited
     FROM tbl_med_mcc_unit_master u
     LEFT JOIN tbl_med_mcc_account_master am ON am.mcccode = u.id
     WHERE u.id = 5637`);
  console.log('\n--- MCC id = 5637 ---');
  console.table(masterById.recordset);

  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
