/*
 * seed-medicare-test.mjs — one-shot bootstrap of the Medicare test client.
 *
 * Creates a Telo login `medicare_test` (Telo role 'billing', LIS usertypeid
 * 2 = Client) and maps it to MCC ABC (id=1) via tbl_med_user_sales_mcc_mapping.
 * After this, the user can log in and see only ABC's data (single-MCC scope =>
 * the New-Order form's Client code is pre-selected + locked).
 *
 * Idempotent on username — if `medicare_test` already exists, the create SP
 * returns CONFLICT and we just ensure the MCC mapping row is present.
 *
 * Run from telo-web/:
 *   node db/scripts/seed-medicare-test.mjs
 *
 * Reads connection from telo-web/.env (TELO_SQL_*). Credentials and the
 * 'medicare_test' / 'Medicare#2026' login are documented in the plan
 * (we-need-to-modernize-hidden-planet.md).
 */

import sql from 'mssql';
import net from 'net';

const USERNAME = 'medicare_test';
const PASSWORD = 'Medicare#2026';
const FIRST = 'Medicare';
const LAST = 'Test';
const LIS_USERTYPE_ID = 2; // 'Client'
const TELO_ROLE = 'billing';
const ACTOR = 6593; // LIS Super Admin (Jas)
const MCC_ID = 1; // ABC

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
console.log(`Connected to ${host} / ${process.env.TELO_SQL_DATABASE}.`);

async function ensureUser() {
  // 1) Create via the existing admin SP (transactional, validated, audited).
  const create = await pool
    .request()
    .input('username', sql.NVarChar(50), USERNAME)
    .input('password', sql.NVarChar(50), PASSWORD)
    .input('firstName', sql.NVarChar(100), FIRST)
    .input('lastName', sql.NVarChar(100), LAST)
    .input('email', sql.NVarChar(100), null)
    .input('lisUsertypeId', sql.Int, LIS_USERTYPE_ID)
    .input('teloRole', sql.NVarChar(20), TELO_ROLE)
    .input('actor', sql.Int, ACTOR)
    .execute('dbo.usp_telo_admin_create_user');
  const row = create.recordset[0];

  if (row?.ok) {
    console.log(`✓ Created user_id=${row.user_id} (${USERNAME}).`);
    return row.user_id;
  }
  if (row?.error_code === 'CONFLICT') {
    const existing = await pool
      .request()
      .input('u', sql.NVarChar(50), USERNAME)
      .query(
        `SELECT id, IsActive, usertypeid FROM dbo.tbl_med_user_master WHERE Username = @u`,
      );
    const id = existing.recordset[0]?.id;
    console.log(
      `· User ${USERNAME} already exists (user_id=${id}). Continuing with mapping.`,
    );
    return id;
  }
  throw new Error(`create_user failed: ${row?.error_code} ${row?.message}`);
}

async function ensureMccMapping(userId) {
  // 2) Add the LIS scope row (idempotent — skip if already there).
  const existing = await pool
    .request()
    .input('uid', sql.Int, userId)
    .input('mcc', sql.Int, MCC_ID)
    .query(
      `SELECT id FROM dbo.tbl_med_user_sales_mcc_mapping
       WHERE user_id = @uid AND mcc_code = @mcc`,
    );
  if (existing.recordset[0]?.id) {
    console.log(
      `· MCC mapping (user_id=${userId}, mcc_code=${MCC_ID}) already present.`,
    );
    return;
  }
  await pool
    .request()
    .input('uid', sql.Int, userId)
    .input('mcc', sql.Int, MCC_ID)
    .input('by', sql.NVarChar(50), `telo:${ACTOR}`)
    .query(
      `INSERT INTO dbo.tbl_med_user_sales_mcc_mapping
         (user_id, mcc_code, addeddate, addedby)
       VALUES (@uid, @mcc, GETDATE(), @by);`,
    );
  console.log(
    `✓ Mapped user_id=${userId} -> mcc_code=${MCC_ID} (ABC).`,
  );
}

try {
  const userId = await ensureUser();
  await ensureMccMapping(userId);

  // 3) Final state summary so you can sanity-check.
  const summary = await pool.request().input('uid', sql.Int, userId).query(`
    SELECT u.id, u.Username, u.IsActive, u.usertypeid, ut.Name AS lisRole,
           r.role AS teloRole,
           (SELECT COUNT(*) FROM dbo.tbl_med_user_sales_mcc_mapping m
            WHERE m.user_id = u.id) AS mccCount,
           (SELECT TOP 1 unit.MCCUnitCode
            FROM dbo.tbl_med_user_sales_mcc_mapping m
            JOIN dbo.tbl_med_mcc_unit_master unit ON unit.id = m.mcc_code
            WHERE m.user_id = u.id) AS firstMccCode
    FROM dbo.tbl_med_user_master u
    LEFT JOIN dbo.tbl_med_usertypes ut ON ut.id = u.usertypeid
    LEFT JOIN dbo.tbl_telo_user_role r ON r.user_id = u.id
    WHERE u.id = @uid;
  `);
  console.log('\nFinal state:');
  console.log(JSON.stringify(summary.recordset[0], null, 2));
  console.log(
    `\nSign in at /login with  ${USERNAME}  /  ${PASSWORD}  — locked to MCC ABC.`,
  );
} finally {
  await pool.close();
}
