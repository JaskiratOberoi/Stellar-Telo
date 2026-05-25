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
};

async function main() {
  const pool = await sql.connect(config);

  // Get the full column list with types
  const cols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, COLUMN_DEFAULT, ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'tbl_med_mcc_test_transactions'
    ORDER BY ORDINAL_POSITION`);
  console.log('\n--- tbl_med_mcc_test_transactions columns ---');
  console.table(cols.recordset);

  // Inspect the reference row — the *working* 15/05 ₹140 ONLINE payment
  const ref = await pool.request().query(
    `SELECT * FROM tbl_med_mcc_test_transactions WHERE id = 5056212`);
  console.log('\n--- Reference row (working 15/05 ONLINE) id=5056212 ---');
  console.log(ref.recordset[0]);

  // Inspect identity column
  const ident = await pool.request().query(`
    SELECT name AS column_name, is_identity, is_nullable
    FROM sys.columns WHERE object_id = OBJECT_ID('tbl_med_mcc_test_transactions') AND is_identity = 1`);
  console.log('\n--- Identity columns ---');
  console.table(ident.recordset);

  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
