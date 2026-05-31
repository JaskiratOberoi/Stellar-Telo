/*
 * 11_table_telo_txn.sql
 *
 * Telo-owned sidecar for unique alphanumeric transaction IDs. Each row in
 * tbl_billing_patient_amount_receipt (payment or refund) gets one telo_txn row
 * keyed by receipt_id. The legacy Noble table is untouched.
 *
 * Idempotent: safe on every deploy.
 */
SET NOCOUNT ON;

IF NOT EXISTS (
    SELECT 1 FROM sys.sequences s
    JOIN sys.schemas sch ON sch.schema_id = s.schema_id
    WHERE sch.name = 'dbo' AND s.name = 'telo_txn_seq'
)
BEGIN
    CREATE SEQUENCE dbo.telo_txn_seq
        AS BIGINT
        START WITH 1
        INCREMENT BY 1
        NO CACHE;
    PRINT 'Created sequence dbo.telo_txn_seq.';
END
ELSE
BEGIN
    PRINT 'Sequence dbo.telo_txn_seq already present.';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo' AND t.name = 'telo_txn'
)
BEGIN
    CREATE TABLE dbo.telo_txn (
        receipt_id  INT          NOT NULL PRIMARY KEY,
        bill_id     INT          NOT NULL,
        txn_id      VARCHAR(24)  NOT NULL,
        created_at  DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_telo_txn_txn_id UNIQUE (txn_id)
    );
    CREATE INDEX IX_telo_txn_bill_id ON dbo.telo_txn (bill_id);
    PRINT 'Created dbo.telo_txn.';
END
ELSE
BEGIN
    PRINT 'dbo.telo_txn already present.';
END
GO
