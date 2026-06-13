/*
 * 26_table_telo_receipt_void.sql
 *
 * Telo-owned sidecar that records VOIDED receipts (payments or refunds) on a
 * bill. We never hard-delete a row from the shared LIS
 * tbl_billing_patient_amount_receipt — instead a super admin "voids" it: the
 * receipt row stays for an audit trail, one row is written here, and the
 * void's reversing effect on the bill's amount_paid / Balance is applied by
 * dbo.usp_telo_void_receipt.
 *
 * Every Telo read that SUMS or LISTS receipts for financial reporting excludes
 * rows present in this table (NOT EXISTS telo_receipt_void). The order/receipt
 * page is the only place a voided row is still shown — struck through, so the
 * admin can see what was removed.
 *
 * `amount` / `receive_status` snapshot the receipt as it was at void time so
 * the trail survives even if the source row is later touched. The legacy Noble
 * table is untouched.
 *
 * Idempotent: safe on every deploy.
 */
SET NOCOUNT ON;

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo' AND t.name = 'telo_receipt_void'
)
BEGIN
    CREATE TABLE dbo.telo_receipt_void (
        receipt_id     INT          NOT NULL PRIMARY KEY,
        bill_id        INT          NOT NULL,
        amount         INT          NOT NULL,
        receive_status VARCHAR(2)   NULL,   -- '1' payment / '2' refund at void time
        voided_by      INT          NULL,   -- LIS user id of the super admin
        voided_date    DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
        reason         NVARCHAR(200) NULL
    );
    CREATE INDEX IX_telo_receipt_void_bill_id ON dbo.telo_receipt_void (bill_id);
    PRINT 'Created dbo.telo_receipt_void.';
END
ELSE
BEGIN
    PRINT 'dbo.telo_receipt_void already present.';
END
GO
