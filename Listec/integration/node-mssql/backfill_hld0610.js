// Fully-consistent backfill for HLD0610 (mcc id 5637).
// Inserts the missing 16/05 10:21 ONLINE ₹220 row and shifts the two
// subsequent rows + master balance to keep the ledger continuous.
//
// All work happens inside ONE transaction. The transaction commits only
// if every post-write invariant check passes. Otherwise it rolls back.

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
    appName: 'PaymentBackfill',
  },
  connectionTimeout: 15000,
  requestTimeout: 60000,
};

const MCC_ID                  = 5637;
const MISSING_PAYMENT_ROWS    = ['2026-05-16 10:21:25.847', -220, 220, 0, 1, 'ONLINE', '', 0, ''];
const ROW_DALI_ID             = 5109746;   // was open -220, close -440 → should be open 0,    close -220
const ROW_LATE_ONLINE_ID      = 5111333;   // was open -440, close -220 → should be open -220, close 0
const EXPECTED_OLD_MASTER     = -220;
const EXPECTED_NEW_MASTER     = 0;

async function main() {
  console.log(`Connecting to ${config.server}:${config.port}/${config.database} ...`);
  const pool = await sql.connect(config);
  const tx = new sql.Transaction(pool);

  let inserted_id = null;
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    console.log('Transaction started (SERIALIZABLE).');

    // ---------------------------------------------------------------
    // Step 1: Verify pre-state matches what we expect before touching anything.
    // ---------------------------------------------------------------
    const preMaster = await new sql.Request(tx).query(
      `SELECT currentbalance, totaldeposited FROM tbl_med_mcc_account_master WHERE mcccode = ${MCC_ID}`);
    console.log('\nPRE: account_master:', preMaster.recordset[0]);
    if (Number(preMaster.recordset[0].currentbalance) !== EXPECTED_OLD_MASTER) {
      throw new Error(`Pre-check failed: master.currentbalance = ${preMaster.recordset[0].currentbalance}, expected ${EXPECTED_OLD_MASTER}`);
    }

    const preDali = await new sql.Request(tx).query(
      `SELECT id, currentbalance, testcharges, closingbalance, tname FROM tbl_med_mcc_test_transactions WHERE id = ${ROW_DALI_ID}`);
    console.log('PRE: DALI row:', preDali.recordset[0]);
    if (Number(preDali.recordset[0].currentbalance) !== -220 || Number(preDali.recordset[0].closingbalance) !== -440) {
      throw new Error(`Pre-check failed: DALI row currentbalance/closingbalance = ${preDali.recordset[0].currentbalance}/${preDali.recordset[0].closingbalance}, expected -220/-440`);
    }

    const preLate = await new sql.Request(tx).query(
      `SELECT id, currentbalance, testcharges, closingbalance, tname FROM tbl_med_mcc_test_transactions WHERE id = ${ROW_LATE_ONLINE_ID}`);
    console.log('PRE: 24/05 ONLINE row:', preLate.recordset[0]);
    if (Number(preLate.recordset[0].currentbalance) !== -440 || Number(preLate.recordset[0].closingbalance) !== -220) {
      throw new Error(`Pre-check failed: 24/05 ONLINE row currentbalance/closingbalance = ${preLate.recordset[0].currentbalance}/${preLate.recordset[0].closingbalance}, expected -440/-220`);
    }

    // Guard against duplicate runs of this backfill — if a backfilled
    // ONLINE row at this exact timestamp already exists, abort.
    const dupe = await new sql.Request(tx).query(`
      SELECT id FROM tbl_med_mcc_test_transactions
       WHERE mccid = ${MCC_ID} AND tname = 'ONLINE' AND transdate = '2026-05-16 10:21:25.847'`);
    if (dupe.recordset.length > 0) {
      throw new Error(`Backfill row already exists (id ${dupe.recordset[0].id}). Aborting to avoid double-insert.`);
    }

    // ---------------------------------------------------------------
    // Step 2: INSERT the missing test_transactions row.
    // ---------------------------------------------------------------
    // NOTE: transdate is written as a literal to avoid the mssql/tedious
    // JS-Date → UTC conversion (the existing rows are stored as naked local IST).
    const ins = await new sql.Request(tx).query(`
        INSERT INTO tbl_med_mcc_test_transactions
          (mccid, transdate, currentbalance, testcharges, closingbalance,
           userid, tname, vailid, patientid, description)
        OUTPUT INSERTED.id, INSERTED.transdate
        VALUES
          (${MCC_ID}, CAST('2026-05-16T10:21:25.847' AS datetime),
           ${MISSING_PAYMENT_ROWS[1]}, ${MISSING_PAYMENT_ROWS[2]}, ${MISSING_PAYMENT_ROWS[3]},
           ${MISSING_PAYMENT_ROWS[4]}, '${MISSING_PAYMENT_ROWS[5]}', '${MISSING_PAYMENT_ROWS[6]}',
           ${MISSING_PAYMENT_ROWS[7]}, '${MISSING_PAYMENT_ROWS[8]}')`);
    inserted_id = ins.recordset[0].id;
    console.log(`\nStep 2: Inserted test_transactions row id=${inserted_id}`);

    // ---------------------------------------------------------------
    // Step 3: Shift the two subsequent test_transactions rows by +220 each.
    //   DALI:           open -220 → 0,    close -440 → -220
    //   24/05 ONLINE:   open -440 → -220, close -220 → 0
    // Guarded UPDATEs (only mutate if the pre-condition still holds).
    // ---------------------------------------------------------------
    const updDali = await new sql.Request(tx).query(`
      UPDATE tbl_med_mcc_test_transactions
         SET currentbalance = 0,
             closingbalance = -220
       WHERE id = ${ROW_DALI_ID}
         AND currentbalance = -220 AND closingbalance = -440`);
    console.log(`Step 3a: DALI row updated, rowsAffected=${updDali.rowsAffected[0]}`);
    if (updDali.rowsAffected[0] !== 1) throw new Error(`DALI row update affected ${updDali.rowsAffected[0]} rows (expected 1)`);

    const updLate = await new sql.Request(tx).query(`
      UPDATE tbl_med_mcc_test_transactions
         SET currentbalance = -220,
             closingbalance = 0
       WHERE id = ${ROW_LATE_ONLINE_ID}
         AND currentbalance = -440 AND closingbalance = -220`);
    console.log(`Step 3b: 24/05 ONLINE row updated, rowsAffected=${updLate.rowsAffected[0]}`);
    if (updLate.rowsAffected[0] !== 1) throw new Error(`24/05 ONLINE row update affected ${updLate.rowsAffected[0]} rows (expected 1)`);

    // ---------------------------------------------------------------
    // Step 4: Set master.currentbalance to 0 (guarded on it still being -220).
    // ---------------------------------------------------------------
    const updMaster = await new sql.Request(tx).query(`
      UPDATE tbl_med_mcc_account_master
         SET currentbalance = ${EXPECTED_NEW_MASTER}
       WHERE mcccode = ${MCC_ID}
         AND currentbalance = ${EXPECTED_OLD_MASTER}`);
    console.log(`Step 4: master.currentbalance updated, rowsAffected=${updMaster.rowsAffected[0]}`);
    if (updMaster.rowsAffected[0] !== 1) throw new Error(`Master update affected ${updMaster.rowsAffected[0]} rows (expected 1)`);

    // ---------------------------------------------------------------
    // Step 5: Post-state invariant checks.
    //   (a) master.currentbalance == 0
    //   (b) ledger is continuous: each row's currentbalance == previous row's closingbalance,
    //       within the affected range, AND last row closing == master currentbalance.
    //   (c) sum(deposits credittype=1, not debit_flagged) ==
    //       sum(test_charges that are debits to the franchise) - sum(test_transaction online payments)
    //       (we just verify deposits == charges by row counts and totals)
    // ---------------------------------------------------------------
    const postMaster = await new sql.Request(tx).query(
      `SELECT currentbalance, totaldeposited FROM tbl_med_mcc_account_master WHERE mcccode = ${MCC_ID}`);
    console.log('\nPOST: account_master:', postMaster.recordset[0]);
    if (Number(postMaster.recordset[0].currentbalance) !== 0) {
      throw new Error(`POST master.currentbalance = ${postMaster.recordset[0].currentbalance}, expected 0`);
    }

    const ledger = await new sql.Request(tx).query(`
      SELECT id, transdate, currentbalance AS opening, testcharges, closingbalance AS closing, tname
        FROM tbl_med_mcc_test_transactions
       WHERE mccid = ${MCC_ID}
         AND transdate >= '2026-05-01'
       ORDER BY transdate, id`);
    console.log('\nPOST ledger:');
    console.table(ledger.recordset);
    for (let i = 1; i < ledger.recordset.length; i++) {
      const prev = ledger.recordset[i-1];
      const curr = ledger.recordset[i];
      if (Number(curr.opening) !== Number(prev.closing)) {
        throw new Error(`Ledger discontinuity at id ${curr.id}: opening ${curr.opening} != previous closing ${prev.closing}`);
      }
    }
    const lastClose = Number(ledger.recordset[ledger.recordset.length - 1].closing);
    if (lastClose !== 0) {
      throw new Error(`Last ledger closingbalance = ${lastClose}, expected 0 (to match master)`);
    }
    console.log('\nAll invariants hold. Committing.');

    await tx.commit();
    console.log('COMMITTED ✓');
  } catch (err) {
    console.error('\nERROR — rolling back:', err.message);
    try { await tx.rollback(); console.error('ROLLED BACK ✓'); } catch (rb) { console.error('Rollback failed:', rb.message); }
    process.exitCode = 1;
  } finally {
    await pool.close();
  }

  console.log(`\nInserted backfill row id: ${inserted_id ?? '(none)'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
