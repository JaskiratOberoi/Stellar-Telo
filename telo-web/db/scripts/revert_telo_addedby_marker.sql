/*
 * revert_telo_addedby_marker.sql  —  one-off, idempotent, Telo-scoped.
 *
 * Undoes the addedby/createdby/receivedby "cleanup" that an earlier backfill
 * applied (it rewrote 'telo:<userId>' to the resolved Username). That marker is
 * NOT a defect — it is how every Telo read path discovers its own orders:
 *
 *     orders.ts  (listPendingAccessions / New-Order worklist)  addedby LIKE 'telo:%'
 *     ledger.ts  (3 queries)                                   addedby LIKE 'telo:%'
 *     receipts.ts                                              addedby LIKE 'telo:%'
 *     12_backfill_telo_txn.sql                                 addedby LIKE 'telo:%'
 *
 * Stripping the marker made newly-registered (no-SID) orders vanish from the
 * New-Order worklist. The LIS report download is unaffected by the marker (it
 * broke on NULL initial/MRNID, which the report backfill fixed and which we
 * leave intact). So we restore the marker.
 *
 * RE-IDENTIFICATION (the marker that told us a row was Telo is gone, so we use
 * durable signals instead):
 *   - Order chain (patient/samples/tests/bill/receipt): rows whose stamp is a
 *     telo_account user's Username. telo_account rows are Telo-managed accounts
 *     with lis_access = 0, so they CANNOT create LIS orders — every order they
 *     stamped is necessarily a Telo order. This deliberately EXCLUDES shared
 *     accounts (e.g. the LIS Super Admin used for dev tests), whose handful of
 *     Telo test orders stay as-is rather than risk relabelling real LIS orders.
 *   - Doctors / customers: rows whose code carries the '-Telo-' brand, which is
 *     only ever produced by usp_telo_upsert_doctor / _customer.
 *
 * Reconstruct 'telo:<id>' from the current Username via tbl_med_user_master
 * (Username is unique, so Username -> id round-trips the original @userId).
 *
 * Idempotent: every UPDATE skips rows already 'telo:%', so re-running is a no-op.
 * Transactional: all-or-nothing.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRAN;

/* ---- order chain: scope to telo_account users (lis_access = 0) --------- */
UPDATE pm
SET pm.addedby = CONCAT('telo:', u.id)
FROM dbo.tbl_med_mcc_patient_master pm
JOIN dbo.tbl_med_user_master u ON u.Username = pm.addedby
JOIN dbo.telo_account a        ON a.user_id  = u.id
WHERE pm.addedby NOT LIKE 'telo:%';
PRINT CONCAT('patient_master.addedby restored: ', @@ROWCOUNT);

UPDATE s
SET s.addedby = CONCAT('telo:', u.id)
FROM dbo.tbl_med_mcc_patient_samples s
JOIN dbo.tbl_med_user_master u ON u.Username = s.addedby
JOIN dbo.telo_account a        ON a.user_id  = u.id
WHERE s.addedby NOT LIKE 'telo:%';
PRINT CONCAT('patient_samples.addedby restored: ', @@ROWCOUNT);

UPDATE t
SET t.addedby = CONCAT('telo:', u.id)
FROM dbo.tbl_med_mcc_patient_tests t
JOIN dbo.tbl_med_user_master u ON u.Username = t.addedby
JOIN dbo.telo_account a        ON a.user_id  = u.id
WHERE t.addedby NOT LIKE 'telo:%';
PRINT CONCAT('patient_tests.addedby restored: ', @@ROWCOUNT);

UPDATE b
SET b.addedby = CONCAT('telo:', u.id)
FROM dbo.tbl_billing_patient_detail b
JOIN dbo.tbl_med_user_master u ON u.Username = b.addedby
JOIN dbo.telo_account a        ON a.user_id  = u.id
WHERE b.addedby NOT LIKE 'telo:%';
PRINT CONCAT('billing_patient_detail.addedby restored: ', @@ROWCOUNT);

UPDATE r
SET r.receivedby = CONCAT('telo:', u.id)
FROM dbo.tbl_billing_patient_amount_receipt r
JOIN dbo.tbl_med_user_master u ON u.Username = r.receivedby
JOIN dbo.telo_account a        ON a.user_id  = u.id
WHERE r.receivedby NOT LIKE 'telo:%';
PRINT CONCAT('amount_receipt.receivedby restored: ', @@ROWCOUNT);

/* ---- masters: scope to the '-Telo-' code brand ------------------------- */
UPDATE d
SET d.createdby = CONCAT('telo:', u.id)
FROM dbo.tbl_med_mcc_doctors d
JOIN dbo.tbl_med_user_master u ON u.Username = d.createdby
WHERE d.doctor_code LIKE '%-Telo-%' AND d.createdby NOT LIKE 'telo:%';
PRINT CONCAT('mcc_doctors.createdby restored: ', @@ROWCOUNT);

UPDATE c
SET c.createdby = CONCAT('telo:', u.id)
FROM dbo.tbl_med_mcc_customer c
JOIN dbo.tbl_med_user_master u ON u.Username = c.createdby
WHERE c.customer_code LIKE '%-Telo-%' AND c.createdby NOT LIKE 'telo:%';
PRINT CONCAT('mcc_customer.createdby restored: ', @@ROWCOUNT);

/* ---- verification: Telo orders discoverable again --------------------- */
SELECT
    bills_marked    = (SELECT COUNT(*) FROM dbo.tbl_billing_patient_detail   WHERE addedby   LIKE 'telo:%'),
    patients_marked = (SELECT COUNT(*) FROM dbo.tbl_med_mcc_patient_master   WHERE addedby   LIKE 'telo:%'),
    samples_marked  = (SELECT COUNT(*) FROM dbo.tbl_med_mcc_patient_samples  WHERE addedby   LIKE 'telo:%'),
    receipts_marked = (SELECT COUNT(*) FROM dbo.tbl_billing_patient_amount_receipt WHERE receivedby LIKE 'telo:%');

COMMIT;
PRINT 'revert_telo_addedby_marker: committed.';
