/*
 * 30_usp_telo_resolve_rate.sql
 *
 * Read-only rate resolution for ONE catalog item. Telo bills at MRP — the
 * catalogue list price — regardless of Client code, so this is a plain MRP
 * lookup:
 *
 *   test    -> tbl_med_test_master.MRP
 *   profile -> tbl_med_test_profile_master.MRP
 *   (none)  -> NULL rate, source 'none'
 *
 * Pass EITHER @testMasterId (a test) OR @profileCode (a profile). The @mcc
 * and @forBilling params are retained for caller-signature compatibility but
 * are no longer used (MRP is MCC-independent); rate_type_id returns NULL.
 *
 * NOTE: tbl_med_test_rates_with_pcc_type and the per-MCC special/ratelist
 * tables are no longer consulted for Telo billing — see addendum 2026-05-22.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_resolve_rate
    @mcc           INT,
    @testMasterId  INT = NULL,
    @profileCode   INT = NULL,
    @forBilling    BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @mrp INT;

    IF @testMasterId IS NOT NULL
        SELECT @mrp = MRP FROM dbo.tbl_med_test_master WHERE id = @testMasterId;
    ELSE IF @profileCode IS NOT NULL
        SELECT @mrp = MRP FROM dbo.tbl_med_test_profile_master WHERE id = @profileCode;

    SELECT
        resolved_rate = @mrp,
        source = CASE WHEN @mrp IS NOT NULL THEN 'mrp' ELSE 'none' END,
        rate_type_id = CAST(NULL AS INT);
END
