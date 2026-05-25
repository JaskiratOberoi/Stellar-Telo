/*
 * 90_usp_telo_set_rate.sql
 *
 * Upsert the price of ONE test in ONE rate list. Updates the active row for
 * (TestCode, RateTypeId) if present, else inserts one. Mirrors how the LIS
 * keys rates: tbl_med_test_rates_with_pcc_type.TestCode is an INT FK to
 * tbl_med_test_master.id (misleading name).
 *
 * Returns: { ok, error_code, message, price }
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_set_rate
    @rateTypeId   INT,
    @testMasterId INT,
    @price        INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @price IS NULL OR @price < 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Price must be a non-negative integer', price = NULL;
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.tbl_med_test_rate_types WHERE id = @rateTypeId)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Unknown rate list', price = NULL;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        DECLARE @existingId INT;
        SELECT TOP 1 @existingId = id
        FROM dbo.tbl_med_test_rates_with_pcc_type WITH (UPDLOCK, HOLDLOCK)
        WHERE TestCode = @testMasterId AND RateTypeId = @rateTypeId
        ORDER BY IsActive DESC, id DESC;

        IF @existingId IS NOT NULL
            UPDATE dbo.tbl_med_test_rates_with_pcc_type
            SET Price = @price, IsActive = 1
            WHERE id = @existingId;
        ELSE
            INSERT INTO dbo.tbl_med_test_rates_with_pcc_type
                (TestCode, RateTypeId, Price, IsActive)
            VALUES (@testMasterId, @rateTypeId, @price, 1);

        COMMIT;
        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200)), price = @price;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200), price = NULL;
    END CATCH
END
