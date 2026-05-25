// Read-only diagnostic queries for HLD0610 ₹220 payment investigation.
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
    appName: process.env.LISTEC_SQL_APP_NAME || 'PaymentDiag',
    serverName: net.isIP(process.env.LISTEC_SQL_SERVER.split(',')[0]) ? 'sqlserver' : undefined,
  },
  connectionTimeout: parseInt(process.env.LISTEC_SQL_CONNECT_TIMEOUT_MS || '15000', 10),
  requestTimeout: parseInt(process.env.LISTEC_SQL_REQUEST_TIMEOUT_MS || '120000', 10),
};

async function main() {
  console.log(`Connecting to ${config.server}:${config.port}/${config.database} as ${config.user} ...`);
  const pool = await sql.connect(config);

  // 1. Resolve HLD0610 → mcc id (code field contains "HLD0610 KAMLA PATHOLOGY LAB")
  const mccRow = await pool.request().query(
    `SELECT id, MCCUnitCode, MCCUnitName
     FROM tbl_med_mcc_unit_master
     WHERE MCCUnitCode LIKE 'HLD0610%'`);
  console.log('\n--- HLD0610 lookup ---');
  console.table(mccRow.recordset);
  if (mccRow.recordset.length === 0) {
    console.log('No MCC row found for HLD0610.');
    await pool.close();
    return;
  }
  const mccid = mccRow.recordset[0].id;

  // 2. account_details payment rows for May 2026
  const details = await pool.request()
    .input('mcc', sql.Int, mccid)
    .query(`
      SELECT id, mcccode, credittype, deposittype, depositedate, amount,
             chequeorddnummber, Reason, addedby, addeddate, debit_flag
      FROM tbl_med_mcc_account_detail
      WHERE mcccode = @mcc
        AND depositedate >= '2026-05-01'
        AND depositedate <= '2026-05-31'
      ORDER BY depositedate, id`);
  console.log('\n--- tbl_med_mcc_account_detail (May 2026) ---');
  console.table(details.recordset);

  // 3. test_transactions rows for May 2026
  const trans = await pool.request()
    .input('mcc', sql.Int, mccid)
    .query(`
      SELECT id, mccid, transdate, currentbalance AS opening,
             testcharges, closingbalance AS closing,
             tname, vailid, patientid, description
      FROM tbl_med_mcc_test_transactions
      WHERE mccid = @mcc
        AND transdate >= '2026-05-01'
        AND transdate <= '2026-05-31'
      ORDER BY transdate, id`);
  console.log('\n--- tbl_med_mcc_test_transactions (May 2026) ---');
  console.table(trans.recordset);

  // 4. Master account row
  const master = await pool.request()
    .input('mcc', sql.Int, mccid)
    .query(`
      SELECT id, mcccode, currentbalance, totaldeposited
      FROM tbl_med_mcc_account_master
      WHERE mcccode = @mcc`);
  console.log('\n--- tbl_med_mcc_account_master ---');
  console.table(master.recordset);

  // 5. Sum check
  const sums = await pool.request()
    .input('mcc', sql.Int, mccid)
    .query(`
      SELECT
        (SELECT ISNULL(SUM(amount),0)
           FROM tbl_med_mcc_account_detail
           WHERE mcccode = @mcc AND credittype = 1
                 AND (debit_flag IS NULL OR debit_flag = 0)) AS total_payments,
        (SELECT ISNULL(SUM(amount),0)
           FROM tbl_med_mcc_account_detail
           WHERE mcccode = @mcc AND credittype = 3) AS total_debits,
        (SELECT ISNULL(SUM(amount),0)
           FROM tbl_med_mcc_account_detail
           WHERE mcccode = @mcc AND credittype = 2) AS total_credits,
        (SELECT ISNULL(SUM(t.test_rate),0)
           FROM tbl_med_mcc_patient_test t
           JOIN tbl_med_mcc_patient_master p ON p.id = t.patient_id
           WHERE p.mcc_code = @mcc AND t.amount_checked = 1) AS total_test_charges`);
  console.log('\n--- Aggregates (all time) ---');
  console.table(sums.recordset);

  // 6. Specifically search for any test_transactions row matching the ₹220 on/around 16/05
  const around220 = await pool.request()
    .input('mcc', sql.Int, mccid)
    .query(`
      SELECT id, transdate, currentbalance, testcharges, closingbalance, tname
      FROM tbl_med_mcc_test_transactions
      WHERE mccid = @mcc
        AND transdate >= '2026-05-16'
        AND transdate <  '2026-05-17'
      ORDER BY transdate, id`);
  console.log('\n--- test_transactions on 16/05/2026 ---');
  console.table(around220.recordset);

  await pool.close();
}

main().catch(err => { console.error('ERROR:', err); process.exit(1); });
