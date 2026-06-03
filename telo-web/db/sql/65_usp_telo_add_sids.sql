/*
 * 65_usp_telo_add_sids.sql  —  deferred accessioning.
 *
 * Adds Sample IDs to an order that was registered without them (or with only
 * some). The receptionist registers patient + tests + bill via
 * usp_telo_create_order; the lab technician later assigns barcodes here when
 * the physical samples arrive.
 *
 * Recomputes the required sample-type groups server-side from the patient's
 * own tbl_med_mcc_patient_tests rows (same CTE as usp_telo_create_order), so
 * the caller can never desync the grouping. Inserts ONE
 * tbl_med_mcc_patient_samples row per supplied (sampleTypeId, vailid) pair.
 * No bill / no ledger writes — money was posted at registration.
 *
 * Validates: patient exists in @mcc; each sampleTypeId is a required group;
 * that group has no sample row yet; vailids are non-empty, unique in-batch,
 * and not already present in tbl_med_mcc_patient_samples.
 *
 * Returns:
 *   - status row: { ok, error_code, message, patient_id, sample_count }
 *   - secondary recordset (samples): one row per issued sample
 *                 { sample_id, vailid, sample_type_id, sample_type_name }
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_add_sids
    @userId    INT,
    @patientId INT,
    @mcc       INT,
    @sids      dbo.TeloSampleSid READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @buCode INT, @mobile VARCHAR(20),
            @o BIT, @ec VARCHAR(20),
            @extraTypes NVARCHAR(200), @dupVailids NVARCHAR(400),
            @filledTypes NVARCHAR(400);

    /* Sample rows are stamped 'telo:<userId>' — the intentional Telo origin
       marker every Telo read path keys on (addedby LIKE 'telo:%'). See
       usp_telo_create_order for the full rationale. */

    DECLARE @emptySamples TABLE (
        sample_id INT, vailid NVARCHAR(50),
        sample_type_id INT, sample_type_name NVARCHAR(100)
    );

    /* =================== validation ====================================== */
    IF NOT EXISTS (SELECT 1 FROM @sids)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'No Sample IDs supplied',
               patient_id = @patientId, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END
    IF EXISTS (SELECT 1 FROM @sids WHERE vailid IS NULL OR LTRIM(RTRIM(vailid)) = N'')
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Every sample type needs a non-empty Sample ID',
               patient_id = @patientId, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END

    SELECT @mobile = mobile_number
    FROM dbo.tbl_med_mcc_patient_master
    WHERE id = @patientId AND mcc_code = @mcc;
    IF @@ROWCOUNT = 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'OUT_OF_SCOPE',
               message = N'Patient not found in this collection centre',
               patient_id = @patientId, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END

    SELECT @buCode = BusinessUnitCode
    FROM dbo.tbl_med_mcc_unit_master WHERE id = @mcc;

    /* Duplicate vailids within the submitted set */
    SELECT @dupVailids = STRING_AGG(vailid, ', ')
    FROM (SELECT vailid FROM @sids GROUP BY vailid HAVING COUNT(*) > 1) d;
    IF @dupVailids IS NOT NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'CONFLICT',
               message = CONCAT(N'Duplicate Sample IDs in this batch: ', @dupVailids),
               patient_id = @patientId, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END
    /* Vailids already in Noble (pre-check; trigger is the hard guarantee) */
    DECLARE @existingVailids NVARCHAR(400) =
        (SELECT STRING_AGG(s.vailid, ', ')
         FROM @sids s
         WHERE EXISTS (SELECT 1 FROM dbo.tbl_med_mcc_patient_samples ps
                       WHERE ps.vailid = s.vailid));
    IF @existingVailids IS NOT NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'CONFLICT',
               message = CONCAT(N'Sample ID(s) already exist: ', @existingVailids),
               patient_id = @patientId, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END

    /* =================== rebuild @items from the patient's tests ========== */
    DECLARE @items dbo.TeloTestList;
    INSERT INTO @items (testMasterId, itemKind, code, name)
    SELECT pt.test_id,
           -- test_type is the LIS enum on new orders ('Profile'/'Test'/'Master'),
           -- or the legacy 'p'/'t' on orders registered before the
           -- sales-visibility change. Map to itemKind 0=test 1=profile 2=master
           -- so a master row re-expands into its child sample groups below.
           CASE WHEN pt.test_type = 'Master' THEN 2
                WHEN pt.test_type IN ('p', 'Profile') THEN 1
                ELSE 0 END,
           LEFT(ISNULL(pt.test_code, CONVERT(NVARCHAR(50), pt.test_id)), 50),
           LEFT(ISNULL(pt.test_name, pt.test_code), 200)
    FROM dbo.tbl_med_mcc_patient_tests pt
    WHERE pt.patient_id = @patientId;

    IF NOT EXISTS (SELECT 1 FROM @items)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Order has no tests — nothing to accession',
               patient_id = @patientId, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END

    /* =================== compute required sample groups =================== */
    /* Identical CTE to usp_telo_create_order so grouping never diverges. */
    /* `selection` flattens masters into child profiles/tests; identical to
       usp_telo_create_order so grouping never diverges. fromMaster tags
       master-derived sample codes 'mp'/'mt'. */
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
        SELECT s.effId AS originId, s.isProfile, s.fromMaster,
               s.effCode AS originCode, s.effName AS originName,
               t.id AS testMasterId, t.TestCode AS testCode,
               t.Testname AS testName, t.SampleId AS sampleTypeId
        FROM selection s
        JOIN dbo.tbl_med_test_master t ON t.id = s.effId AND t.IsActive = 1
        WHERE s.isProfile = 0
        UNION ALL
        SELECT s.effId AS originId, s.isProfile, s.fromMaster,
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
        FROM item_resolution WHERE isProfile = 1 GROUP BY originId
    ),
    /* codeType is the LIS per-code sample-row type ('t'/'p', or 'mt'/'mp' for
       master-derived codes) — see usp_telo_create_order for the rationale. */
    bucketed AS (
        SELECT ISNULL(ir.sampleTypeId, -1) AS sampleTypeId,
               ir.testCode AS code, ir.testName AS name,
               CASE WHEN ir.fromMaster = 1 THEN 'mt' ELSE 't' END AS codeType
        FROM item_resolution ir WHERE ir.isProfile = 0
        UNION ALL
        SELECT DISTINCT ISNULL(ir.sampleTypeId, -1), ir.originCode,
               ir.originName,
               CASE WHEN ir.fromMaster = 1 THEN 'mp' ELSE 'p' END
        FROM item_resolution ir
        JOIN profile_span ps ON ps.originId = ir.originId
        WHERE ir.isProfile = 1 AND ps.span = 1
        UNION ALL
        SELECT ISNULL(ir.sampleTypeId, -1), ir.testCode, ir.testName,
               CASE WHEN ir.fromMaster = 1 THEN 'mt' ELSE 't' END
        FROM item_resolution ir
        JOIN profile_span ps ON ps.originId = ir.originId
        WHERE ir.isProfile = 1 AND ps.span > 1
    )
    SELECT
        b.sampleTypeId,
        ISNULL(sm.Sampletype, N'Unspecified') AS sampleTypeName,
        STRING_AGG(CONVERT(NVARCHAR(MAX), b.code), N',')
            WITHIN GROUP (ORDER BY b.code) AS csvCodes,
        STRING_AGG(CONVERT(NVARCHAR(MAX), b.name), N',')
            WITHIN GROUP (ORDER BY b.code) AS csvNames,
        STRING_AGG(CONVERT(NVARCHAR(MAX), b.codeType), N',')
            WITHIN GROUP (ORDER BY b.code) AS csvTypes
    INTO #groups
    FROM bucketed b
    LEFT JOIN dbo.tbl_med_sample_master sm ON sm.id = b.sampleTypeId
    GROUP BY b.sampleTypeId, sm.Sampletype;

    /* Reject SIDs for a sample type this order does not need */
    SELECT @extraTypes = STRING_AGG(CONVERT(NVARCHAR(20), s.sampleTypeId), ', ')
    FROM @sids s
    WHERE NOT EXISTS (SELECT 1 FROM #groups g WHERE g.sampleTypeId = s.sampleTypeId);
    IF @extraTypes IS NOT NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = CONCAT(N'Sample IDs supplied for unused sample type(s): ', @extraTypes),
               patient_id = @patientId, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END

    /* Reject sample types already accessioned (a row already exists). The
       Unspecified bucket (-1) maps to a NULL sampleid in the table. */
    SELECT @filledTypes = STRING_AGG(CONVERT(NVARCHAR(20), s.sampleTypeId), ', ')
    FROM @sids s
    WHERE EXISTS (
        SELECT 1 FROM dbo.tbl_med_mcc_patient_samples ps
        WHERE ps.patient_id = @patientId
          AND ISNULL(ps.sampleid, -1) = s.sampleTypeId);
    IF @filledTypes IS NOT NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'CONFLICT',
               message = CONCAT(N'Sample type(s) already accessioned: ', @filledTypes),
               patient_id = @patientId, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END

    /* =================== the write ======================================= */
    DECLARE @insertedSamples TABLE (
        sample_id INT, vailid NVARCHAR(50), sampleid_db INT
    );

    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO dbo.tbl_med_mcc_patient_samples
            (patient_id, sampleid, testcodes, testnames, testtypes,
             vailid, sample_status, addedby, addeddate, modifieddate,
             lastmodified_date, business_unit_id, mobile_number)
        OUTPUT inserted.id, inserted.vailid, inserted.sampleid
            INTO @insertedSamples (sample_id, vailid, sampleid_db)
        SELECT @patientId,
               NULLIF(g.sampleTypeId, -1) AS sampleid,
               LEFT(g.csvCodes, 1000),
               LEFT(g.csvNames, 1000),
               LEFT(g.csvTypes, 500),
               s.vailid, 1, CONCAT(N'telo:', @userId), GETDATE(), GETDATE(),
               GETDATE(), @buCode, LEFT(@mobile, 12)
        FROM #groups g
        JOIN @sids s ON s.sampleTypeId = g.sampleTypeId;

        COMMIT;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(400)),
               patient_id = @patientId,
               sample_count = (SELECT COUNT(*) FROM @insertedSamples);
        SELECT
            ins.sample_id,
            ins.vailid,
            sids.sampleTypeId AS sample_type_id,
            ISNULL(g.sampleTypeName, N'Unspecified') AS sample_type_name
        FROM @insertedSamples ins
        JOIN @sids sids ON sids.vailid = ins.vailid
        LEFT JOIN #groups g ON g.sampleTypeId = sids.sampleTypeId
        ORDER BY sids.sampleTypeId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        DECLARE @msg NVARCHAR(2048) = ERROR_MESSAGE();
        DECLARE @code VARCHAR(20) =
            CASE WHEN @msg LIKE '%DUPLICATES PREVENTED%' THEN 'CONFLICT'
                 ELSE 'INTERNAL' END;
        SELECT ok = CAST(0 AS BIT), error_code = @code,
               message = LEFT(@msg, 400),
               patient_id = @patientId, sample_count = 0;
        SELECT * FROM @emptySamples;
    END CATCH
END
