/*
 * 30_usp_telo_resolve_rate.sql
 *
 * Read-only rate resolution for ONE catalog item, honouring the Client's
 * assigned rate list. Two-tier, MCC-aware:
 *
 *   tier 1 (ratelist) : the price for this test/profile in the rate list
 *                       assigned to the MCC (tbl_med_mcc_unit_master.RateType).
 *                         test    -> tbl_med_test_rates_with_pcc_type.Price
 *                         profile -> tbl_med_profile_rates_with_pcc_types.Price
 *   tier 2 (mrp)      : fall back to catalogue MRP when the item is not in the
 *                       rate list (or the MCC has no rate list assigned).
 *                         test    -> tbl_med_test_master.MRP
 *                         profile -> tbl_med_test_profile_master.MRP
 *   (none)            : NULL rate, source 'none'.
 *
 * Pass EITHER @testMasterId (a test) OR @profileCode (a profile). @forBilling
 * is retained for caller-signature compatibility but does not change the
 * result — preview and billing must resolve identically so the displayed
 * price always equals the billed price.
 *
 * Reads are LIVE against the rate tables (no caching here) so an updated rate
 * list in the LIS is reflected by Telo immediately — no re-sync step.
 *
 * History: 2026-05-22 simplified to MRP-only; 2026-05-31 restored rate-list
 * resolution so per-Client rate lists (e.g. MEDICARE MRP RATE LIST) bill
 * correctly. The MCC->RateType link lives on tbl_med_mcc_unit_master.RateType.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_resolve_rate
    @mcc           INT,
    @testMasterId  INT = NULL,
    @profileCode   INT = NULL,
    @forBilling    BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @rate INT = NULL,
            @rateType INT = NULL,
            @src VARCHAR(20) = 'none',
            @rtid INT = NULL;

    -- The Client's assigned rate list (NULL if the MCC has none -> MRP only).
    SELECT @rateType = RateType
    FROM dbo.tbl_med_mcc_unit_master
    WHERE id = @mcc;

    IF @testMasterId IS NOT NULL
    BEGIN
        -- tier 1: rate-list price
        IF @rateType IS NOT NULL
            SELECT @rate = Price
            FROM dbo.tbl_med_test_rates_with_pcc_type
            WHERE TestCode = @testMasterId
              AND RateTypeId = @rateType
              AND IsActive = 1;

        IF @rate IS NOT NULL
            SELECT @src = 'ratelist', @rtid = @rateType;
        ELSE
        BEGIN
            -- tier 2: catalogue MRP
            SELECT @rate = MRP FROM dbo.tbl_med_test_master WHERE id = @testMasterId;
            IF @rate IS NOT NULL SET @src = 'mrp';
        END
    END
    ELSE IF @profileCode IS NOT NULL
    BEGIN
        IF @rateType IS NOT NULL
            SELECT @rate = Price
            FROM dbo.tbl_med_profile_rates_with_pcc_types
            WHERE profilecode = @profileCode
              AND RateTypeId = @rateType
              AND IsActive = 1;

        IF @rate IS NOT NULL
            SELECT @src = 'ratelist', @rtid = @rateType;
        ELSE
        BEGIN
            SELECT @rate = MRP FROM dbo.tbl_med_test_profile_master WHERE id = @profileCode;
            IF @rate IS NOT NULL SET @src = 'mrp';
        END
    END

    SELECT
        resolved_rate = @rate,
        source        = @src,
        rate_type_id  = @rtid;
END
