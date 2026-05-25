/*
 * 50_usp_telo_next_bill_number.sql
 *
 * Per-MCC, per-month bill number. Format (confirmed from live data):
 *   bill_number = YYMM * 10000 + seq    e.g. 2026-04 seq 1 -> 26040001
 * Resets monthly, scoped to one MCC (same number recurs across mcc_codes).
 * Serialised with an app-lock keyed by mcc+YYMM.
 *
 * Pure OUTPUT params — emits NO result set so it composes cleanly inside
 * usp_telo_create_order's nested EXEC.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_next_bill_number
    @mcc         INT,
    @bill_number INT          OUTPUT,
    @ok          BIT          OUTPUT,
    @error_code  VARCHAR(20)  OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @ok = 0; SET @error_code = NULL; SET @bill_number = NULL;

    DECLARE @yymm INT = CONVERT(INT, FORMAT(GETDATE(), 'yyMM'));
    DECLARE @base INT = @yymm * 10000;
    DECLARE @res NVARCHAR(80) = CONCAT('telo_bill_', @mcc, '_', @yymm);
    DECLARE @lock INT;

    EXEC @lock = sp_getapplock
        @Resource = @res, @LockMode = 'Exclusive',
        @LockOwner = 'Transaction', @LockTimeout = 10000;

    IF @lock < 0
    BEGIN
        SET @error_code = 'CONFLICT';
        RETURN;
    END

    SELECT @bill_number = ISNULL(MAX(b.bill_number), @base) + 1
    FROM dbo.tbl_billing_patient_detail b WITH (UPDLOCK, HOLDLOCK)
    WHERE b.mcc_code = @mcc
      AND b.bill_number BETWEEN @base + 1 AND @base + 9999;

    SET @ok = 1;
END
