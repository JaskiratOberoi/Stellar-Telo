/*
 * 30_usp_telo_resolve_rate.sql
 *
 * Read-only rate resolution for ONE catalog item, honouring the Client's
 * per-MCC special rate first, then its assigned rate list, then MRP. This
 * mirrors the LIS billing path (CheckTransCash / GetTestRate), which always
 * prefers the per-MCC special rate over the rate-list price.
 *
 *   tier 0 (special)  : tbl_med_mcc_test_special_rates for this MCC + item
 *                         test    -> testtype 'T', testid = test id
 *                         profile -> testtype 'P', testid = profile id
 *                         master  -> testtype 'M', testid = master-profile id
 *   tier 1 (ratelist) : the price for this item in the rate list assigned to
 *                       the MCC (tbl_med_mcc_unit_master.RateType).
 *                         test    -> tbl_med_test_rates_with_pcc_type.Price
 *                         profile -> tbl_med_profile_rates_with_pcc_types.Price
 *                         master  -> tbl_med_master_profile_rates_with_pcc_types.Price
 *   tier 2 (mrp)      : catalogue MRP.
 *                         test    -> tbl_med_test_master.MRP
 *                         profile -> tbl_med_test_profile_master.MRP
 *                         master  -> tbl_med_test_master_profile_master.MRP
 *   (none)            : NULL rate, source 'none'.
 *
 * Pass EXACTLY ONE of @testMasterId / @profileCode / @masterCode. @forBilling
 * is retained for caller-signature compatibility but does not change the
 * result — preview and billing must resolve identically.
 *
 * Reads are LIVE against the rate tables (no caching here) so an updated rate
 * list or special rate in the LIS is reflected by Telo immediately.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_resolve_rate
    @mcc           INT,
    @testMasterId  INT = NULL,
    @profileCode   INT = NULL,
    @masterCode    INT = NULL,
    @forBilling    BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @rate INT = NULL,
            @rateType INT = NULL,
            @src VARCHAR(20) = 'none',
            @rtid INT = NULL;

    -- The Client's assigned rate list (NULL if the MCC has none -> special/MRP only).
    SELECT @rateType = RateType
    FROM dbo.tbl_med_mcc_unit_master
    WHERE id = @mcc;

    IF @testMasterId IS NOT NULL
    BEGIN
        -- tier 0: per-MCC special rate
        SELECT @rate = rate
        FROM dbo.tbl_med_mcc_test_special_rates
        WHERE mcccode = @mcc AND testtype = 'T' AND testid = @testMasterId;
        IF @rate IS NOT NULL SET @src = 'special';

        -- tier 1: rate-list price
        IF @rate IS NULL AND @rateType IS NOT NULL
        BEGIN
            SELECT @rate = Price
            FROM dbo.tbl_med_test_rates_with_pcc_type
            WHERE TestCode = @testMasterId
              AND RateTypeId = @rateType
              AND IsActive = 1;
            IF @rate IS NOT NULL SELECT @src = 'ratelist', @rtid = @rateType;
        END

        -- tier 2: catalogue MRP
        IF @rate IS NULL
        BEGIN
            SELECT @rate = MRP FROM dbo.tbl_med_test_master WHERE id = @testMasterId;
            IF @rate IS NOT NULL SET @src = 'mrp';
        END
    END
    ELSE IF @profileCode IS NOT NULL
    BEGIN
        SELECT @rate = rate
        FROM dbo.tbl_med_mcc_test_special_rates
        WHERE mcccode = @mcc AND testtype = 'P' AND testid = @profileCode;
        IF @rate IS NOT NULL SET @src = 'special';

        IF @rate IS NULL AND @rateType IS NOT NULL
        BEGIN
            SELECT @rate = Price
            FROM dbo.tbl_med_profile_rates_with_pcc_types
            WHERE profilecode = @profileCode
              AND RateTypeId = @rateType
              AND IsActive = 1;
            IF @rate IS NOT NULL SELECT @src = 'ratelist', @rtid = @rateType;
        END

        IF @rate IS NULL
        BEGIN
            SELECT @rate = MRP FROM dbo.tbl_med_test_profile_master WHERE id = @profileCode;
            IF @rate IS NOT NULL SET @src = 'mrp';
        END
    END
    ELSE IF @masterCode IS NOT NULL
    BEGIN
        SELECT @rate = rate
        FROM dbo.tbl_med_mcc_test_special_rates
        WHERE mcccode = @mcc AND testtype = 'M' AND testid = @masterCode;
        IF @rate IS NOT NULL SET @src = 'special';

        IF @rate IS NULL AND @rateType IS NOT NULL
        BEGIN
            SELECT @rate = Price
            FROM dbo.tbl_med_master_profile_rates_with_pcc_types
            WHERE master_profile_code = @masterCode
              AND RateTypeId = @rateType
              AND IsActive = 1;
            IF @rate IS NOT NULL SELECT @src = 'ratelist', @rtid = @rateType;
        END

        IF @rate IS NULL
        BEGIN
            SELECT @rate = MRP FROM dbo.tbl_med_test_master_profile_master WHERE id = @masterCode;
            IF @rate IS NOT NULL SET @src = 'mrp';
        END
    END

    SELECT
        resolved_rate = @rate,
        source        = @src,
        rate_type_id  = @rtid;
END
