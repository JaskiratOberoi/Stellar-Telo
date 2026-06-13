/*
 * 27_table_telo_test_cancellation.sql
 *
 * Telo-owned sidecar recording a super admin CANCELLING a single test on a
 * Telo bill. We never delete the original LIS bill line; instead a negative
 * "(Cancelled)" offset line is added to the bill (the on-bill audit trail) and
 * one row is written here capturing who/when/why plus a snapshot of the test.
 *
 * `line_id` is the cancelled bill line (tbl_billing_patient_test_detail.id) —
 * it locks the line (idempotent: a line can be cancelled once) and lets the
 * order read flag that line as cancelled. `sid`/`sample_id` record which SID
 * (if any) had the test code pulled from its testcodes.
 *
 * The legacy Noble tables are untouched. Idempotent: safe on every deploy.
 */
SET NOCOUNT ON;

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo' AND t.name = 'telo_test_cancellation'
)
BEGIN
    CREATE TABLE dbo.telo_test_cancellation (
        id             INT          IDENTITY(1,1) PRIMARY KEY,
        bill_id        INT          NOT NULL,
        patient_id     INT          NULL,
        line_id        INT          NOT NULL,   -- cancelled tbl_billing_patient_test_detail.id
        test_code      NVARCHAR(20) NULL,
        test_name      NVARCHAR(200) NULL,
        amount         INT          NOT NULL,
        sid            NVARCHAR(50) NULL,        -- SID whose testcodes was edited (if any)
        sample_id      INT          NULL,
        cancelled_by   INT          NULL,        -- LIS user id of the super admin
        cancelled_date DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
        reason         NVARCHAR(200) NOT NULL
    );
    CREATE INDEX IX_telo_test_cancellation_bill_id ON dbo.telo_test_cancellation (bill_id);
    CREATE UNIQUE INDEX UQ_telo_test_cancellation_line_id ON dbo.telo_test_cancellation (line_id);
    PRINT 'Created dbo.telo_test_cancellation.';
END
ELSE
BEGIN
    PRINT 'dbo.telo_test_cancellation already present.';
END
GO
