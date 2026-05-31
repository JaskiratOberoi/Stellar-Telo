/*
 * 12_backfill_telo_txn.sql
 *
 * Assign txn IDs to existing Telo receipt rows that pre-date the sidecar
 * table. Idempotent — rows already in telo_txn are skipped.
 */
SET NOCOUNT ON;

IF OBJECT_ID('dbo.telo_txn', 'U') IS NULL
BEGIN
    PRINT 'dbo.telo_txn not present — skipping backfill.';
END
ELSE
BEGIN
    INSERT INTO dbo.telo_txn (receipt_id, bill_id, txn_id)
    SELECT
        p.receipt_id,
        p.bill_id,
        CONCAT(
            N'TXN',
            RIGHT(
                CONCAT(N'00000000', CONVERT(VARCHAR(20), NEXT VALUE FOR dbo.telo_txn_seq)),
                8
            )
        )
    FROM (
        SELECT r.id AS receipt_id, r.bill_id
        FROM dbo.tbl_billing_patient_amount_receipt r
        JOIN dbo.tbl_billing_patient_detail b ON b.id = r.bill_id
        WHERE b.addedby LIKE N'telo:%'
          AND NOT EXISTS (
              SELECT 1 FROM dbo.telo_txn t WHERE t.receipt_id = r.id
          )
    ) p;

    PRINT CONCAT('Backfilled ', @@ROWCOUNT, ' telo_txn row(s).');
END
GO
