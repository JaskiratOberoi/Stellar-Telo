/*
 * 91_usp_telo_create_rate_list.sql
 *
 * Create a new rate list and SEED it from the default 'rate' list (the
 * original base, tbl_med_test_rate_types.id = 1). Every test gets the default
 * price; the operator then edits per-test as needed via usp_telo_set_rate.
 * Atomic. Rejects blank/duplicate names.
 *
 * Returns: { ok, error_code, message, rate_type_id, seeded_count }
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_create_rate_list
    @name   NVARCHAR(50),
    @userId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @name = LTRIM(RTRIM(@name));
    IF @name IS NULL OR @name = N''
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Rate list name is required',
               rate_type_id = NULL, seeded_count = 0;
        RETURN;
    END
    IF EXISTS (SELECT 1 FROM dbo.tbl_med_test_rate_types WHERE Rate = @name)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'CONFLICT',
               message = CONCAT(N'A rate list named "', @name, N'" already exists'),
               rate_type_id = NULL, seeded_count = 0;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        -- tbl_med_test_rate_types has only (id, Rate, Description, IsActive).
        INSERT INTO dbo.tbl_med_test_rate_types (Rate, Description, IsActive)
        VALUES (@name, CONCAT(N'Created via Telo by user ', ISNULL(@userId, 0)), 1);
        DECLARE @newId INT = SCOPE_IDENTITY();

        -- Seed from the default base list (RateTypeId = 1, 'rate').
        INSERT INTO dbo.tbl_med_test_rates_with_pcc_type
            (TestCode, RateTypeId, Price, IsActive)
        SELECT d.TestCode, @newId, d.Price, 1
        FROM dbo.tbl_med_test_rates_with_pcc_type d
        WHERE d.RateTypeId = 1 AND d.IsActive = 1;
        DECLARE @seed INT = @@ROWCOUNT;

        COMMIT;
        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200)),
               rate_type_id = @newId, seeded_count = @seed;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200),
               rate_type_id = NULL, seeded_count = 0;
    END CATCH
END
