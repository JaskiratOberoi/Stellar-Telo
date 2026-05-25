/*
 * 10_type_TeloTestList.sql — table-valued parameter for order line items.
 *
 * Passed to usp_telo_create_order. Carries identity only; the SP re-resolves
 * the rate server-side (client price is never trusted). Guarded against
 * double-create like Listec's ClientCodeList TVP.
 */
IF TYPE_ID(N'dbo.TeloTestList') IS NULL
BEGIN
    CREATE TYPE dbo.TeloTestList AS TABLE
    (
        testMasterId INT          NOT NULL,  -- tbl_med_test_master.id OR tbl_med_test_profile_master.id
        isProfile    BIT          NOT NULL,  -- 1 = profile/package, 0 = single test
        code         NVARCHAR(50) NOT NULL,
        name         NVARCHAR(200) NOT NULL,
        PRIMARY KEY (testMasterId, isProfile)
    );
END
