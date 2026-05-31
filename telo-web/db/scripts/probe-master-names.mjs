/*
 * probe-master-names.mjs — peek at what's in master for specific keywords.
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

const keywords = ['HbA1c', 'HBA1C', 'Glucose', 'Glycosyl', 'CRP', 'C-Reactive', 'Bilirubin', 'Body Profile', 'Bone Profile', 'CPK', 'HDL'];
for (const kw of keywords) {
  const r = await pool.request().input('q', sql.NVarChar, `%${kw}%`).query(`
    SELECT TOP 5 id, TestCode AS code, Testname AS name, IsActive
    FROM dbo.tbl_med_test_master
    WHERE Testname LIKE @q
    ORDER BY IsActive DESC, Testname
  `);
  console.log(`\n── tests LIKE "${kw}" ──`);
  for (const x of r.recordset) {
    console.log(`  #${x.id}  ${x.code}  IsActive=${x.IsActive}  "${x.name}"`);
  }
  const p = await pool.request().input('q', sql.NVarChar, `%${kw}%`).query(`
    SELECT TOP 5 id, Profile_Code AS code, Profile_Name AS name, IsActive
    FROM dbo.tbl_med_test_profile_master
    WHERE Profile_Name LIKE @q
    ORDER BY IsActive DESC, Profile_Name
  `);
  if (p.recordset.length > 0) {
    console.log(`  profiles:`);
    for (const x of p.recordset) {
      console.log(`    #${x.id}  ${x.code}  IsActive=${x.IsActive}  "${x.name}"`);
    }
  }
}
await pool.close();
