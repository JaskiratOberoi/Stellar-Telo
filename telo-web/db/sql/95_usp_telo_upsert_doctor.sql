/*
 * 95_usp_telo_upsert_doctor.sql
 *
 * Existence-or-insert for tbl_med_mcc_doctors keyed by trimmed
 * (doctor_name, pcc_code). In Noble every doctor is owned by exactly one
 * MCC via pcc_code → tbl_med_mcc_unit_master.id (misleadingly named
 * column; 100% historical alignment with bill.mcc_code).
 *
 * New rows are stamped with doctor_code = '{ClientCode}-Telo-{Initials}'
 * — operator-friendly and Telo-origin-marked. ClientCode comes from the
 * owning MCC's MCCUnitCode; Initials are the uppercase first character of
 * each whitespace-separated word in doctor_name (e.g. "Dr Telo Test"
 * → "DTT"). doctor_code is purely informational in Noble (not a unique
 * key); collisions are tolerated since id is the actual PK.
 *
 * Used inside dbo.usp_telo_create_order's transaction when the operator
 * typed a brand-new Ref. doctor in the creatable combobox — abandoned
 * forms therefore never pollute the master.
 *
 * Output: @id holds the resolved doctor id (existing or newly inserted).
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_upsert_doctor
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
    FROM dbo.tbl_med_mcc_doctors
    WHERE IsActive = 1 AND doctor_name = @clean AND pcc_code = @mcc
    ORDER BY id;

    IF @id IS NOT NULL RETURN;

    /* ---- compute the {ClientCode}-Telo-{Initials} doctor_code ------------- */
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

    /* createdby is the intentional 'telo:<userId>' origin marker (Telo read
       paths key on createdby/addedby LIKE 'telo:%'); the '-Telo-' doctor_code
       already brands the row for humans. */
    INSERT INTO dbo.tbl_med_mcc_doctors
        (doctor_name, doctor_code, pcc_code, IsActive, createdby, createddate)
    VALUES
        (@clean, @code, @mcc, 1, CONCAT(N'telo:', @userId), GETDATE());
    SET @id = SCOPE_IDENTITY();
END
