/*
 * 35_usp_telo_preview_sample_groups.sql
 *
 * Read-only: given the user's selected items (the same TeloTestList TVP that
 * create_order takes), return ONE row per distinct sample type the order
 * requires. The New Order form uses this to render N SID inputs labeled by
 * sample type — exactly matching the LIS "New Work Order" SID table.
 *
 * Sample type derivation:
 *   - Test  → tbl_med_test_master.SampleId → tbl_med_sample_master.Sampletype
 *   - Profile → walk tbl_med_test_profile_param to constituent tests, take
 *     each one's SampleId. A profile that fits ONE sample type keeps its
 *     profile code in that bucket; a profile that spans multiple sample
 *     types is "split" into constituent test codes across the affected
 *     buckets (requiresSplit = 1).
 *
 * Inactive constituent tests are filtered (IsActive = 1). Items with no
 * SampleId resolve to sampleTypeId = -1 ("Unspecified") so the operator
 * still sees them and supplies a SID (matches LIS leniency).
 *
 * Returns:
 *   (sampleTypeId INT, sampleTypeName NVARCHAR, csvCodes NVARCHAR,
 *    csvNames NVARCHAR, csvTestMasterIds NVARCHAR, requiresSplit BIT,
 *    itemCount INT)
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_preview_sample_groups
    @items dbo.TeloTestList READONLY
AS
BEGIN
    SET NOCOUNT ON;

    /* ----- Resolve every selected item to (testMasterId, code, name, sampleTypeId) -----
       Two paths combined:
         (a) tests as-is (the item's own row in test_master)
         (b) profile expansion through tbl_med_test_profile_param to constituents */
    ;WITH item_resolution AS (
        -- Tests: contribute themselves
        SELECT
            i.testMasterId AS originId,
            i.isProfile,
            i.code        AS originCode,
            i.name        AS originName,
            t.id          AS testMasterId,
            t.TestCode    AS testCode,
            t.Testname    AS testName,
            t.SampleId    AS sampleTypeId
        FROM @items i
        JOIN dbo.tbl_med_test_master t ON t.id = i.testMasterId AND t.IsActive = 1
        WHERE i.isProfile = 0

        UNION ALL

        -- Profiles: expand to constituent active tests
        SELECT
            i.testMasterId AS originId,
            i.isProfile,
            i.code        AS originCode,
            i.name        AS originName,
            t.id          AS testMasterId,
            t.TestCode    AS testCode,
            t.Testname    AS testName,
            t.SampleId    AS sampleTypeId
        FROM @items i
        JOIN dbo.tbl_med_test_profile_param pp ON pp.profileid = i.testMasterId
        JOIN dbo.tbl_med_test_master t ON t.id = pp.testid AND t.IsActive = 1
        WHERE i.isProfile = 1
    ),
    /* Per-profile: count distinct sample types its constituents need.
       If 1 → keep the profile code in that one bucket (LIS visual).
       If >1 → split (use constituent test codes in each affected bucket). */
    profile_span AS (
        SELECT originId, COUNT(DISTINCT ISNULL(sampleTypeId, -1)) AS span
        FROM item_resolution
        WHERE isProfile = 1
        GROUP BY originId
    ),
    /* Bucket assignment: what code/name lives in each sample-type bucket. */
    bucketed AS (
        -- Tests: own code/name per the test's own sample type
        SELECT
            ISNULL(ir.sampleTypeId, -1) AS sampleTypeId,
            ir.testCode AS code,
            ir.testName AS name,
            ir.testMasterId AS testMasterId
        FROM item_resolution ir
        WHERE ir.isProfile = 0

        UNION ALL

        -- Profile fits single sample type: emit profile code/name ONCE per bucket
        SELECT DISTINCT
            ISNULL(ir.sampleTypeId, -1) AS sampleTypeId,
            ir.originCode AS code,
            ir.originName AS name,
            ir.originId AS testMasterId
        FROM item_resolution ir
        JOIN profile_span ps ON ps.originId = ir.originId
        WHERE ir.isProfile = 1 AND ps.span = 1

        UNION ALL

        -- Profile spans multiple sample types: emit constituent test code/name per bucket
        SELECT
            ISNULL(ir.sampleTypeId, -1) AS sampleTypeId,
            ir.testCode AS code,
            ir.testName AS name,
            ir.testMasterId AS testMasterId
        FROM item_resolution ir
        JOIN profile_span ps ON ps.originId = ir.originId
        WHERE ir.isProfile = 1 AND ps.span > 1
    )
    SELECT
        b.sampleTypeId,
        ISNULL(sm.Sampletype, N'Unspecified') AS sampleTypeName,
        -- SQL Server requires all STRING_AGGs in the same scope to share an
        -- ORDER BY; we sort everything by code for consistent display.
        STRING_AGG(CONVERT(NVARCHAR(MAX), b.code), N',')
            WITHIN GROUP (ORDER BY b.code) AS csvCodes,
        STRING_AGG(CONVERT(NVARCHAR(MAX), b.name), N', ')
            WITHIN GROUP (ORDER BY b.code) AS csvNames,
        STRING_AGG(CONVERT(NVARCHAR(MAX), b.testMasterId), N',')
            WITHIN GROUP (ORDER BY b.code) AS csvTestMasterIds,
        CAST(CASE WHEN EXISTS (
            SELECT 1 FROM profile_span ps
            JOIN item_resolution ir ON ir.originId = ps.originId
            WHERE ps.span > 1 AND ISNULL(ir.sampleTypeId, -1) = b.sampleTypeId
        ) THEN 1 ELSE 0 END AS BIT) AS requiresSplit,
        COUNT(*) AS itemCount
    FROM bucketed b
    LEFT JOIN dbo.tbl_med_sample_master sm ON sm.id = b.sampleTypeId
    GROUP BY b.sampleTypeId, sm.Sampletype
    ORDER BY b.sampleTypeId;
END
