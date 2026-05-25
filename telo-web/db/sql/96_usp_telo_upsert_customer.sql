/*
 * 96_usp_telo_upsert_customer.sql
 *
 * Existence-or-insert for tbl_med_mcc_customer keyed by trimmed
 * (customer_name, pcc_code). Twin of dbo.usp_telo_upsert_doctor — see
 * that file for the per-MCC scoping rationale.
 *
 * New rows are stamped with customer_code = '{ClientCode}-Telo-{Initials}'
 * using the owning MCC's MCCUnitCode and the customer_name's word-start
 * initials.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_upsert_customer
    @name   NVARCHAR(200),
    @mcc    INT,
    @userId INT,
    @id     INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @clean NVARCHAR(100) = LEFT(LTRIM(RTRIM(@name)), 100);
    IF @clean IS NULL OR @clean = N'' OR @mcc IS NULL
    BEGIN
        SET @id = NULL;
        RETURN;
    END

    SELECT TOP 1 @id = id
    FROM dbo.tbl_med_mcc_customer
    WHERE IsActive = 1 AND customer_name = @clean AND pcc_code = @mcc
    ORDER BY id;

    IF @id IS NOT NULL RETURN;

    DECLARE @mccCode NVARCHAR(50);
    SELECT @mccCode = LTRIM(RTRIM(MCCUnitCode))
    FROM dbo.tbl_med_mcc_unit_master WHERE id = @mcc;
    SET @mccCode = ISNULL(@mccCode, CONVERT(NVARCHAR(20), @mcc));

    DECLARE @initials NVARCHAR(40) = N'';
    DECLARE @s NVARCHAR(220) = LTRIM(RTRIM(@clean));
    DECLARE @ix INT;
    WHILE LEN(@s) > 0
    BEGIN
        SET @ix = CHARINDEX(N' ', @s);
        IF @ix = 0
        BEGIN
            SET @initials = @initials + UPPER(LEFT(@s, 1));
            BREAK;
        END
        IF @ix > 1
            SET @initials = @initials + UPPER(LEFT(@s, 1));
        SET @s = LTRIM(SUBSTRING(@s, @ix + 1, LEN(@s)));
    END

    DECLARE @code NVARCHAR(50) =
        LEFT(CONCAT(@mccCode, N'-Telo-', @initials), 50);

    INSERT INTO dbo.tbl_med_mcc_customer
        (customer_name, customer_code, pcc_code, IsActive, createdby, createddate)
    VALUES
        (@clean, @code, @mcc, 1, CONCAT(N'telo:', @userId), GETDATE());
    SET @id = SCOPE_IDENTITY();
END
