/*
 * 35_usp_telo_preview_sample_groups.sql
 *
 * Read-only: given the user's selected items (the same TeloTestList TVP that
 * create_order takes), return ONE row per distinct sample type the order
 * requires. The New Order form uses this to render N SID inputs labeled by
 * sample type — exactly matching the LIS "New Work Order" SID table.
 *
 * Item kinds (TeloTestList.itemKind):
 *   0 test    → its own SampleId.
 *   1 profile → walk tbl_med_test_profile_param to constituent tests; a profile
 *               fitting ONE sample type keeps its code in that bucket, one that
 *               spans many is split into constituent test codes (requiresSplit).
 *   2 master  → decomposed (mirrors LIS Workor.aspx.cs) into its child profiles
 *               (tbl_med_test_master_profile_param) and child tests
 *               (tbl_med_test_master_test_param); each child then follows the
 *               same profile/test rules above. Sample-row codeType carries the
 *               LIS 'mp'/'mt' tags but those don't change which sample types are
 *               required, so the preview shape is unchanged.
 *
 * Inactive constituent tests are filtered (IsActive = 1). Items with no
 * SampleId resolve to sampleTypeId = -1 ("Unspecified").
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

    /* ----- Flatten masters into their child profiles/tests -----------------
       `selection` reduces every TVP row to one or more (effId, isProfile)
       entries: tests/profiles pass through; a master expands to its child
       profiles (isProfile=1) and child tests (isProfile=0). fromMaster marks
       the rows that originated from a master so the sample codeType can be
       tagged 'mp'/'mt' downstream. */
    ;WITH selection AS (
        SELECT i.testMasterId AS effId, CAST(0 AS BIT) AS isProfile,
               i.code AS effCode, i.name AS effName, CAST(0 AS BIT) AS fromMaster
        FROM @items i WHERE i.itemKind = 0
        UNION ALL
        SELECT i.testMasterId, CAST(1 AS BIT), i.code, i.name, CAST(0 AS BIT)
        FROM @items i WHERE i.itemKind = 1
        UNION ALL
        SELECT mpp.profileid, CAST(1 AS BIT),
               pmf.Profile_Code, pmf.Profile_Name, CAST(1 AS BIT)
        FROM @items i
        JOIN dbo.tbl_med_test_master_profile_param mpp ON mpp.master_profileid = i.testMasterId
        JOIN dbo.tbl_med_test_profile_master pmf ON pmf.id = mpp.profileid AND pmf.IsActive = 1
        WHERE i.itemKind = 2
        UNION ALL
        SELECT mtp.testid, CAST(0 AS BIT),
               CONVERT(NVARCHAR(50), tmf.TestCode), tmf.Testname, CAST(1 AS BIT)
        FROM @items i
        JOIN dbo.tbl_med_test_master_test_param mtp ON mtp.master_profileid = i.testMasterId
        JOIN dbo.tbl_med_test_master tmf ON tmf.id = mtp.testid AND tmf.IsActive = 1
        WHERE i.itemKind = 2
    ),
    item_resolution AS (
        -- Tests: contribute themselves
        SELECT
            s.effId AS originId, s.isProfile, s.fromMaster,
            s.effCode AS originCode, s.effName AS originName,
            t.id AS testMasterId, t.TestCode AS testCode,
            t.Testname AS testName, t.SampleId AS sampleTypeId
        FROM selection s
        JOIN dbo.tbl_med_test_master t ON t.id = s.effId AND t.IsActive = 1
        WHERE s.isProfile = 0

        UNION ALL

        -- Profiles: expand to constituent active tests
        SELECT
            s.effId AS originId, s.isProfile, s.fromMaster,
            s.effCode AS originCode, s.effName AS originName,
            t.id AS testMasterId, t.TestCode AS testCode,
            t.Testname AS testName, t.SampleId AS sampleTypeId
        FROM selection s
        JOIN dbo.tbl_med_test_profile_param pp ON pp.profileid = s.effId
        JOIN dbo.tbl_med_test_master t ON t.id = pp.testid AND t.IsActive = 1
        WHERE s.isProfile = 1
    ),
    profile_span AS (
        SELECT originId, COUNT(DISTINCT ISNULL(sampleTypeId, -1)) AS span
        FROM item_resolution
        WHERE isProfile = 1
        GROUP BY originId
    ),
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
