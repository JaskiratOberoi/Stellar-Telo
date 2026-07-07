/*
 * 100_table_telo_receipt_edit.sql
 *
 * Telo-owned sidecar that records every AMOUNT EDIT made to a receipt
 * (payment or refund) on a bill. A super admin can correct the amount of an
 * already-recorded transaction — the receipt row keeps its id, its telo_txn
 * number and its recd_date exactly as they were; only `amount` changes
 * (applied in place by dbo.usp_telo_edit_receipt_amount, which also shifts
 * the bill's amount_paid / Balance by the delta).
 *
 * One row is appended here per edit (a receipt can be edited more than once),
 * so the full before/after history survives: who changed it, when, from what
 * to what, and why. `reason` is mandatory — the action layer refuses blank
 * reasons and so does the SP.
 *
 * Reads that SUM receipts need no changes (the source row carries the new
 * amount); the order page joins this table only to show the "modified" badge
 * and its tooltip. The printed bill/receipt PDFs deliberately do NOT surface
 * the badge — they show the corrected amount as if it were always so.
 *
 * Idempotent: safe on every deploy.
 */
SET NOCOUNT ON;

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo' AND t.name = 'telo_receipt_edit'
)
BEGIN
    CREATE TABLE dbo.telo_receipt_edit (
        id          INT           NOT NULL IDENTITY(1,1) PRIMARY KEY,
        receipt_id  INT           NOT NULL,
        bill_id     INT           NOT NULL,
        old_amount  INT           NOT NULL,
        new_amount  INT           NOT NULL,
        edited_by   INT           NULL,   -- LIS user id of the super admin
        edited_date DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        reason      NVARCHAR(200) NOT NULL
    );
    CREATE INDEX IX_telo_receipt_edit_receipt_id ON dbo.telo_receipt_edit (receipt_id);
    CREATE INDEX IX_telo_receipt_edit_bill_id ON dbo.telo_receipt_edit (bill_id);
    PRINT 'Created dbo.telo_receipt_edit.';
END
ELSE
BEGIN
    PRINT 'dbo.telo_receipt_edit already present.';
END
GO
