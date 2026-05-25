/*
 * One-off cleanup — removes the 2 junk Telo test orders at client ABC and
 * drops the now-obsolete vailid generator. EXACTLY scoped to:
 *   patients 3260969, 3260970   (name LIKE 'LOADTEST%', mcc_code = 1 / ABC)
 *   vailids '8988895695894747848','8988895695894747849'
 *   bills   24158, 24159        (bill_number 26050001, 26050002)
 * Restores the ABC account balance for the 2 ledger debits we posted.
 * Transactional: all-or-nothing. Run once.
 */
SET XACT_ABORT ON;
BEGIN TRAN;

DECLARE @pids TABLE (id INT);
INSERT INTO @pids VALUES (3260969), (3260970);

DECLARE @bills TABLE (id INT);
INSERT INTO @bills
SELECT id FROM dbo.tbl_billing_patient_detail
WHERE id IN (24158, 24159)
  AND mcc_code = 1
  AND patientname LIKE 'LOADTEST%';   -- guard: only the test bills

-- Restore ABC (mcc 1) balance for the debits usp_telo_post_ledger posted.
DECLARE @restore INT =
  ISNULL((SELECT SUM(amount) FROM dbo.tbl_med_mcc_account_detail
          WHERE mcccode = 1 AND debit_flag = 1 AND credittype = 3
            AND (Reason LIKE '%8988895695894747848%'
              OR Reason LIKE '%8988895695894747849%')), 0);

DELETE FROM dbo.tbl_billing_patient_test_detail
 WHERE billid IN (SELECT id FROM @bills);

DELETE FROM dbo.tbl_billing_patient_amount_receipt
 WHERE bill_id IN (SELECT id FROM @bills);

DELETE FROM dbo.tbl_billing_patient_detail
 WHERE id IN (SELECT id FROM @bills);

DELETE FROM dbo.tbl_med_mcc_patient_test_result
 WHERE patientid IN (SELECT id FROM @pids);

DELETE FROM dbo.tbl_med_mcc_patient_tests
 WHERE patient_id IN (SELECT id FROM @pids);

DELETE FROM dbo.tbl_med_mcc_patient_samples
 WHERE patient_id IN (SELECT id FROM @pids)
   AND vailid IN ('8988895695894747848','8988895695894747849');

DELETE FROM dbo.tbl_med_mcc_patient_master
 WHERE id IN (SELECT id FROM @pids)
   AND name LIKE 'LOADTEST%' AND mcc_code = 1;   -- guard

DELETE FROM dbo.tbl_med_mcc_test_transactions
 WHERE vailid IN ('8988895695894747848','8988895695894747849');

DELETE FROM dbo.tbl_med_mcc_account_detail
 WHERE mcccode = 1 AND debit_flag = 1 AND credittype = 3
   AND (Reason LIKE '%8988895695894747848%'
     OR Reason LIKE '%8988895695894747849%');

UPDATE dbo.tbl_med_mcc_account_master
   SET currentbalance = currentbalance + @restore
 WHERE mcccode = 1;

PRINT CONCAT('Cleanup done. Restored balance: ', @restore);
COMMIT;

-- Obsolete: vailid is the external sample ID, never generated.
IF OBJECT_ID('dbo.usp_telo_next_vailid') IS NOT NULL
    DROP PROCEDURE dbo.usp_telo_next_vailid;
