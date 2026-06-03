/*
 * One clean verification order. Real test (APTT id 1), caller-supplied SID.
 * Usage:
 *   npx tsx db/scripts/place-verification-order.ts --mcc 1 --vailid 73736656578388249
 * Reads back all 7 tables so you can cross-check in the Noble LIS.
 */
import { config as loadEnv } from 'dotenv';
import path from 'path';
import sql from 'mssql';
loadEnv({ path: path.resolve(__dirname, '..', '..', '.env') });
loadEnv();
import { getTeloPoolConfig } from '../config';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const mcc = Number(arg('mcc') ?? 1);
  const vailid = arg('vailid');
  const testId = Number(arg('test') ?? 1);
  if (!vailid) throw new Error('--vailid <sampleSID> required');

  const pool = await new sql.ConnectionPool(getTeloPoolConfig()).connect();
  const tvp = new sql.Table('dbo.TeloTestList');
  tvp.create = false;
  tvp.columns.add('testMasterId', sql.Int, { nullable: false });
  tvp.columns.add('itemKind', sql.TinyInt, { nullable: false }); // 0=test 1=profile 2=master
  tvp.columns.add('code', sql.NVarChar(50), { nullable: false });
  tvp.columns.add('name', sql.NVarChar(200), { nullable: false });
  tvp.rows.add(testId, 0, 'IGNORED', 'IGNORED'); // SP resolves canonical name

  const r = await pool
    .request()
    .input('userId', sql.Int, 6593)
    .input('mcc', sql.Int, mcc)
    .input('vailid', sql.NVarChar(50), vailid)
    .input('patientId', sql.Int, 0)
    .input('name', sql.NVarChar(200), 'TELO VERIFY ' + new Date().toISOString().slice(0, 16))
    .input('initial', sql.NVarChar(10), 'Mr')
    .input('age', sql.Int, 30)
    .input('gender', sql.Int, 1)
    .input('mobile', sql.VarChar(20), '9999900000')
    .input('items', tvp)
    .execute<Record<string, unknown>>('dbo.usp_telo_create_order');
  const sets = r.recordsets as unknown as Array<Array<Record<string, unknown>>>;
  const o = sets.length ? sets[sets.length - 1][0] : {};
  console.log('=== RESULT ===');
  console.log(JSON.stringify(o, null, 2));

  if ((o as { ok?: boolean }).ok) {
    const pid = (o as { patient_id: number }).patient_id;
    const bid = (o as { bill_id: number }).bill_id;
    const q = (sqlText: string) => pool.request().query(sqlText);
    console.log('\n① patient_master');
    console.table((await q(`SELECT id,mcc_code,name,age,gender,addedby FROM tbl_med_mcc_patient_master WHERE id=${pid}`)).recordset);
    console.log('② patient_tests');
    console.table((await q(`SELECT test_id,test_code,test_name,test_rate,test_type FROM tbl_med_mcc_patient_tests WHERE patient_id=${pid}`)).recordset);
    console.log('③ patient_samples (SID)');
    console.table((await pool.request().input('v', sql.NVarChar(50), vailid).query(`SELECT id,patient_id,vailid,testcodes,testnames,sample_status FROM tbl_med_mcc_patient_samples WHERE vailid=@v`)).recordset);
    console.log('④ billing_patient_detail');
    console.table((await q(`SELECT id,bill_number,mcc_code,patientname,amount,Balance FROM tbl_billing_patient_detail WHERE id=${bid}`)).recordset);
    console.log('⑤ billing_patient_test_detail');
    console.table((await q(`SELECT billid,testcode,testname,testamount,testtype FROM tbl_billing_patient_test_detail WHERE billid=${bid}`)).recordset);
    console.log('⑦ ledger txn');
    console.table((await pool.request().input('v', sql.NVarChar(50), vailid).query(`SELECT mccid,testcharges,closingbalance,tname,vailid,patientid FROM tbl_med_mcc_test_transactions WHERE vailid=@v`)).recordset);
  }
  await pool.close();
}
main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
