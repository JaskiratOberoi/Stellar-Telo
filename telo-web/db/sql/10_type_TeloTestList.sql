/*
 * 10_type_TeloTestList.sql — table-valued parameter for order line items.
 *
 * Passed to usp_telo_create_order / usp_telo_preview_sample_groups. Carries
 * identity only; the SP re-resolves the rate server-side (client price is never
 * trusted).
 *
 * itemKind: 0 = single test   (tbl_med_test_master.id)
 *           1 = profile        (tbl_med_test_profile_master.id)
 *           2 = master profile (tbl_med_test_master_profile_master.id) — a
 *               bundle of child profiles + tests, decomposed server-side.
 *
 * MIGRATION: earlier builds shipped this type with an `isProfile BIT` column
 * (two kinds only). A TABLE type can't be ALTERed, and can't be dropped while a
 * proc references it, so when the legacy shape is detected we drop the three
 * referencing procs first (they are re-created by 35_/60_/65_, which deploy
 * after this file) and recreate the type with the itemKind column.
 */
IF TYPE_ID(N'dbo.TeloTestList') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1
        FROM sys.table_types tt
        JOIN sys.columns c ON c.object_id = tt.type_table_object_id
        WHERE tt.name = 'TeloTestList' AND c.name = 'itemKind')
BEGIN
    IF OBJECT_ID('dbo.usp_telo_create_order', 'P') IS NOT NULL
        DROP PROCEDURE dbo.usp_telo_create_order;
    IF OBJECT_ID('dbo.usp_telo_preview_sample_groups', 'P') IS NOT NULL
        DROP PROCEDURE dbo.usp_telo_preview_sample_groups;
    IF OBJECT_ID('dbo.usp_telo_add_sids', 'P') IS NOT NULL
        DROP PROCEDURE dbo.usp_telo_add_sids;
    DROP TYPE dbo.TeloTestList;
    PRINT 'Dropped legacy dbo.TeloTestList (+ dependent procs) for itemKind migration.';
END

IF TYPE_ID(N'dbo.TeloTestList') IS NULL
BEGIN
    CREATE TYPE dbo.TeloTestList AS TABLE
    (
        testMasterId INT           NOT NULL,  -- test / profile / master-profile id (per itemKind)
        itemKind     TINYINT       NOT NULL,  -- 0 = test, 1 = profile, 2 = master profile
        code         NVARCHAR(50)  NOT NULL,
        name         NVARCHAR(200) NOT NULL,
        PRIMARY KEY (testMasterId, itemKind)
    );
    PRINT 'Created dbo.TeloTestList (itemKind shape).';
END
