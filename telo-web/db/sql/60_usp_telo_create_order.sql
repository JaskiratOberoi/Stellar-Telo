/*
 * 60_usp_telo_create_order.sql  —  THE atomic order write.
 *
 * One transaction across the LIS order chain:
 *   ① tbl_med_mcc_patient_master   (create patient, or reuse @patientId)
 *   ② tbl_med_mcc_patient_tests    (one row per line — UNbilled: amount_checked
 *                                   / updateddate stay NULL until the LIS
 *                                   Accession "Register" bills them)
 *   ③ tbl_med_mcc_patient_samples  (N rows — ONE per distinct sample type)
 *   ④ tbl_billing_patient_detail   (Telo bill header, generated bill_number)
 *   ⑤ tbl_billing_patient_test_detail (one row per line)
 *   ⑥ tbl_billing_patient_amount_receipt (one row per payment line — split
 *                                   payments supported; none if paid ₹0)
 *
 * The franchise wallet is NOT debited here. The LIS debits it when the order
 * is moved Accessioning → Worksheet (Accession "Register" → CheckTransCash) —
 * doing it here too would double-debit. ④⑤⑥ are Telo-internal bill records
 * and are invisible to the LIS sales/ledger reports.
 *
 * MULTI-SID MODEL: matches the legacy LIS. Tests that share a physical sample
 * type share one SID; tests requiring different sample types each get their
 * own SID. All SIDs link to ONE patient (PID). The caller supplies one
 * (sampleTypeId, vailid) pair per distinct sample type via @sids; the SP
 * recomputes the required group set server-side and never trusts the caller's
 * grouping decision — only their SID assignments.
 *
 * @sids is OPTIONAL: an order may be registered with no SIDs (deferred) or a
 * partial set. The lab technician accessions the remaining SIDs later via
 * dbo.usp_telo_add_sids. Only sample rows for the supplied SIDs are written.
 *
 * Rate is ALWAYS re-resolved here (3-tier, MCC RateType) and test code/name
 * resolved from masters — client values are never trusted. Pass @patientId=0
 * to create a new patient.
 *
 * Returns:
 *   - status row: { ok, error_code, message, patient_id, bill_id,
 *                   bill_number, total, sample_count }
 *   - secondary recordset (samples): one row per issued sample
 *                 { sample_id, vailid, sample_type_id, sample_type_name }
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_create_order
    @userId           INT,
    @mcc              INT,
    @sids             dbo.TeloSampleSid READONLY,
    @patientId        INT            = 0,
    @name             NVARCHAR(200)  = NULL,
    @initial          NVARCHAR(10)   = NULL,
    @age              INT            = NULL,
    @gender           INT            = NULL,
    @ageType          INT            = NULL,
    @mobile           VARCHAR(20)    = NULL,
    @email            VARCHAR(100)   = NULL,
    @clinicalHistory  VARCHAR(500)   = NULL,
    @clinicalFile     VARBINARY(MAX) = NULL,
    @clinicalFileName VARCHAR(100)   = NULL,
    @mrnId            VARCHAR(50)    = NULL,
    @refDoctor        INT            = NULL,
    @refCustomer      INT            = NULL,
    @newRefDoctorName   NVARCHAR(200) = NULL,
    @newRefCustomerName NVARCHAR(200) = NULL,
    @items            dbo.TeloTestList READONLY,
    @discountAmount   INT            = 0,
    @paymentType      VARCHAR(50)    = NULL,
    @payMode          INT            = NULL,
    @receiptAmount    INT            = 0,
    @billAtMrp        BIT            = 0,
    @paymentRef       VARCHAR(100)   = NULL,
    -- Split payments: one row per payment line (₹500 Cash + ₹500 UPI). When
    -- supplied (and non-empty) it SUPERSEDES the @paymentType/@receiptAmount/
    -- @paymentRef scalars, which are kept only for older single-payment callers.
    @payments         dbo.TeloPayment READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @pid INT, @billId INT, @billNo INT,
            @total INT = 0, @rateTypeId INT, @buCode INT, @pname NVARCHAR(200),
            @o BIT, @ec VARCHAR(20), @sampleCount INT = 0,
            @txn VARCHAR(24);

    /* addedby/createdby/receivedby is stamped 'telo:<userId>'. This is an
       INTENTIONAL Telo origin marker, not a defect: every Telo read path
       (the New-Order/pending-accession worklist in orders.ts, the ledger and
       receipts reports, the txn backfill) finds Telo orders with
       `addedby LIKE 'telo:%'`. It does NOT break the LIS report download — that
       failure was caused by NULL initial/MRNID (fixed below); hundreds of
       thousands of normal LIS rows carry a non-Username addedby and print fine.
       Keep the marker so Telo can identify its own orders. */

    /* Salutation kept in patient_master.initial (separate from name) — the LIS
       report download dereferences it, so it must never be NULL. Falls back to
       a gender-derived title when the form left it blank. */
    DECLARE @initialFinal NVARCHAR(10) =
        COALESCE(NULLIF(LTRIM(RTRIM(@initial)), N''),
                 CASE @gender WHEN 1 THEN N'Mr' WHEN 2 THEN N'Ms' ELSE N'Mr' END);

    /* ---- declared variable for SID-validation messaging ------------------- */
    DECLARE @extraTypes NVARCHAR(200), @dupVailids NVARCHAR(400);

    /* Empty-result samples table for early-return paths so callers always
       see two recordsets (status + samples). */
    DECLARE @emptySamples TABLE (
        sample_id INT, vailid NVARCHAR(50),
        sample_type_id INT, sample_type_name NVARCHAR(100)
    );

    /* =================== validation ====================================== */
    IF NOT EXISTS (SELECT 1 FROM dbo.tbl_med_mcc_unit_master
                   WHERE id = @mcc AND IsActive = 1)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Unknown or inactive collection centre',
               patient_id = NULL, bill_id = NULL, bill_number = NULL,
               total = 0, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM @items)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'No test/profile lines supplied',
               patient_id = NULL, bill_id = NULL, bill_number = NULL,
               total = 0, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END
    /* @sids is OPTIONAL — an order may be registered with no SIDs (the lab
       technician accessions them later via usp_telo_add_sids). A partial set
       is also fine. Any row that IS supplied must carry a non-empty vailid. */
    IF EXISTS (SELECT 1 FROM @sids WHERE vailid IS NULL OR LTRIM(RTRIM(vailid)) = N'')
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Every sample type needs a non-empty Sample ID',
               patient_id = NULL, bill_id = NULL, bill_number = NULL,
               total = 0, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END
    /* Duplicate vailids within the submitted set */
    SELECT @dupVailids = STRING_AGG(vailid, ', ')
    FROM (SELECT vailid FROM @sids GROUP BY vailid HAVING COUNT(*) > 1) d;
    IF @dupVailids IS NOT NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'CONFLICT',
               message = CONCAT(N'Duplicate Sample IDs within this order: ', @dupVailids),
               patient_id = NULL, bill_id = NULL, bill_number = NULL,
               total = 0, sample_count = 0;
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
               patient_id = NULL, bill_id = NULL, bill_number = NULL,
               total = 0, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END
    /* A mobile number may belong to at most 4 Telo-registered patients. The
       form and registerOrder pre-check this live; this is the authoritative
       gate. Only Telo-created rows count (addedby 'telo:%' — native LIS
       patients don't consume the allowance) and only a NEW patient row can
       consume a slot (@patientId reuse adds no patient). */
    IF (@patientId IS NULL OR @patientId = 0)
       AND @mobile IS NOT NULL AND LTRIM(RTRIM(@mobile)) <> ''
    BEGIN
        DECLARE @mobileUses INT =
            (SELECT COUNT(*) FROM dbo.tbl_med_mcc_patient_master
             WHERE mobile_number = @mobile AND addedby LIKE 'telo:%');
        IF @mobileUses >= 4
        BEGIN
            SELECT ok = CAST(0 AS BIT), error_code = 'CONFLICT',
                   message = CONCAT(N'This mobile number is already used by ',
                                    @mobileUses,
                                    N' patients — the limit is 4 patients per number.'),
                   patient_id = NULL, bill_id = NULL, bill_number = NULL,
                   total = 0, sample_count = 0;
            SELECT * FROM @emptySamples;
            RETURN;
        END
    END

    SELECT @rateTypeId = RateType, @buCode = BusinessUnitCode
    FROM dbo.tbl_med_mcc_unit_master WHERE id = @mcc;

    /* =================== rate-resolved @lines (per user-selected item) ==== */
    /* One row per user-selected item. A master profile bills as a SINGLE line
       (test_type 'Master') — its children are NOT billed individually; they
       only drive sample grouping below. itemKind: 0=test 1=profile 2=master. */
    DECLARE @lines TABLE (
        rn           INT IDENTITY(1,1),
        testMasterId INT,
        itemKind     TINYINT,
        code         NVARCHAR(50),
        name         NVARCHAR(200),
        testtype     CHAR(1),
        rate         INT
    );

    INSERT INTO @lines (testMasterId, itemKind, code, name, testtype, rate)
    SELECT
        i.testMasterId, i.itemKind,
        CASE i.itemKind
          WHEN 0 THEN (SELECT t.TestCode FROM dbo.tbl_med_test_master t
                         WHERE t.id = i.testMasterId AND t.IsActive = 1)
          WHEN 1 THEN (SELECT pm.Profile_Code FROM dbo.tbl_med_test_profile_master pm
                         WHERE pm.id = i.testMasterId AND pm.IsActive = 1)
          ELSE (SELECT mp.Master_Profile_Code FROM dbo.tbl_med_test_master_profile_master mp
                  WHERE mp.id = i.testMasterId AND mp.IsActive = 1)
        END,
        CASE i.itemKind
          WHEN 0 THEN (SELECT t.Testname FROM dbo.tbl_med_test_master t
                         WHERE t.id = i.testMasterId AND t.IsActive = 1)
          WHEN 1 THEN (SELECT pm.Profile_Name FROM dbo.tbl_med_test_profile_master pm
                         WHERE pm.id = i.testMasterId AND pm.IsActive = 1)
          ELSE (SELECT mp.Master_Profile_Name FROM dbo.tbl_med_test_master_profile_master mp
                  WHERE mp.id = i.testMasterId AND mp.IsActive = 1)
        END,
        CASE i.itemKind WHEN 1 THEN 'p' WHEN 2 THEN 'm' ELSE 't' END,
        -- Rate MUST mirror usp_telo_resolve_rate so the billed price equals the
        -- price previewed in the order form:
        --   tier 0: per-MCC special rate (tbl_med_mcc_test_special_rates) — the
        --           LIS always prefers this over the rate list (CheckTransCash).
        --   tier 1: rate-list Price for @rateTypeId
        --   tier 2: catalogue MRP
        --   tier 3: 0 (never NULL — billing line needs a number)
        COALESCE(
          CASE WHEN @billAtMrp = 1 THEN NULL ELSE (SELECT sr.rate FROM dbo.tbl_med_mcc_test_special_rates sr
             WHERE sr.mcccode = @mcc
               AND sr.testtype = CASE i.itemKind WHEN 0 THEN 'T' WHEN 1 THEN 'P' ELSE 'M' END
               AND sr.testid = i.testMasterId) END,
          CASE WHEN @billAtMrp = 1 THEN NULL ELSE CASE i.itemKind
            WHEN 0 THEN (SELECT r.Price FROM dbo.tbl_med_test_rates_with_pcc_type r
                           WHERE r.TestCode = i.testMasterId
                             AND r.RateTypeId = @rateTypeId AND r.IsActive = 1)
            WHEN 1 THEN (SELECT r.Price FROM dbo.tbl_med_profile_rates_with_pcc_types r
                           WHERE r.profilecode = i.testMasterId
                             AND r.RateTypeId = @rateTypeId AND r.IsActive = 1)
            ELSE (SELECT r.Price FROM dbo.tbl_med_master_profile_rates_with_pcc_types r
                    WHERE r.master_profile_code = i.testMasterId
                      AND r.RateTypeId = @rateTypeId AND r.IsActive = 1)
          END END,
          CASE i.itemKind
            WHEN 0 THEN (SELECT t.MRP FROM dbo.tbl_med_test_master t WHERE t.id = i.testMasterId)
            WHEN 1 THEN (SELECT pm.MRP FROM dbo.tbl_med_test_profile_master pm WHERE pm.id = i.testMasterId)
            ELSE (SELECT mp.MRP FROM dbo.tbl_med_test_master_profile_master mp WHERE mp.id = i.testMasterId)
          END,
          0)
    FROM @items i;

    IF EXISTS (SELECT 1 FROM @lines WHERE code IS NULL OR name IS NULL)
    BEGIN
        DECLARE @bad NVARCHAR(400) =
            (SELECT STRING_AGG(CONCAT(CASE itemKind WHEN 1 THEN 'profile#' WHEN 2 THEN 'master#' ELSE 'test#' END,
                                      testMasterId), ', ')
             FROM @lines WHERE code IS NULL OR name IS NULL);
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = CONCAT(N'Unknown or inactive test/profile/master id(s): ', @bad),
               patient_id = NULL, bill_id = NULL, bill_number = NULL,
               total = 0, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END

    SELECT @total = ISNULL(SUM(rate), 0) FROM @lines;

    /* =================== compute required sample groups =================== */
    /* Mirror the preview SP exactly so the SP is self-contained and the form
       can never desync the grouping. */
    /* `selection` flattens every TVP row to one or more (effId, isProfile)
       entries: tests/profiles pass through; a master (itemKind=2) expands to
       its child profiles + child tests. fromMaster marks master-derived rows
       so the sample codeType is tagged 'mp'/'mt' (the LIS Master tags) instead
       of 'p'/'t'. The test/profile path is byte-for-byte the prior logic. */
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
    /* codeType is the LIS per-code sample-row type — CheckTransCash routes each
       sample code to its bucket by this: 't'/'p' for direct test/profile,
       'mt'/'mp' for codes that came from a master profile. A one-sample-type
       profile keeps the profile code; a split profile contributes test codes. */
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

    /* SIDs are optional/partial — a missing sample type is NOT rejected (the
       lab tech accessions it later). We only reject SIDs for a sample type
       this order does not need. */
    SELECT @extraTypes = STRING_AGG(CONVERT(NVARCHAR(20), s.sampleTypeId), ', ')
    FROM @sids s
    WHERE NOT EXISTS (SELECT 1 FROM #groups g WHERE g.sampleTypeId = s.sampleTypeId);
    IF @extraTypes IS NOT NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = CONCAT(N'Sample IDs supplied for unused sample type(s): ', @extraTypes),
               patient_id = NULL, bill_id = NULL, bill_number = NULL,
               total = @total, sample_count = 0;
        SELECT * FROM @emptySamples;
        RETURN;
    END

    /* sample_count reflects the rows actually being written now (the SIDs
       supplied that match a required group) — may be 0 for a deferred order. */
    SELECT @sampleCount = COUNT(*)
    FROM @sids s JOIN #groups g ON g.sampleTypeId = s.sampleTypeId;

    /* =================== the write ======================================= */
    /* OUTPUT cannot contain subqueries, so we capture identity only and
       enrich with the sample-type name from #groups in the final SELECT. */
    DECLARE @insertedSamples TABLE (
        sample_id INT, vailid NVARCHAR(50), sampleid_db INT
    );

    BEGIN TRY
        BEGIN TRAN;

        /* ⓪ resolve new Ref. doctor / customer names → master ids.
           Runs inside the order transaction so abandoned forms never
           pollute the master. Existing-id paths (positive @refDoctor /
           @refCustomer) are untouched. */
        IF @newRefDoctorName IS NOT NULL AND LTRIM(RTRIM(@newRefDoctorName)) <> N''
        BEGIN
            DECLARE @newDocId INT;
            EXEC dbo.usp_telo_upsert_doctor
                @name = @newRefDoctorName,
                @mcc = @mcc,
                @userId = @userId,
                @id = @newDocId OUTPUT;
            IF @newDocId IS NOT NULL SET @refDoctor = @newDocId;
        END
        IF @newRefCustomerName IS NOT NULL AND LTRIM(RTRIM(@newRefCustomerName)) <> N''
        BEGIN
            DECLARE @newCustId INT;
            EXEC dbo.usp_telo_upsert_customer
                @name = @newRefCustomerName,
                @mcc = @mcc,
                @userId = @userId,
                @id = @newCustId OUTPUT;
            IF @newCustId IS NOT NULL SET @refCustomer = @newCustId;
        END

        /* ① patient */
        IF @patientId IS NULL OR @patientId = 0
        BEGIN
            INSERT INTO dbo.tbl_med_mcc_patient_master
                (mcc_code, name, initial, age, gender, age_type, sample_date,
                 sample_time, ref_doctor, ref_customer, Status,
                 Clinical_History, mobile_number, order_number, email,
                 MRNID, addedby, addeddate)
            VALUES
                (@mcc, @name, @initialFinal, @age, @gender, @ageType,
                 CAST(GETDATE() AS DATE),
                 GETDATE(), @refDoctor, @refCustomer, 1,
                 @clinicalHistory, @mobile, '', @email,
                 @mrnId, CONCAT(N'telo:', @userId), GETDATE());
            SET @pid = SCOPE_IDENTITY();
            SET @pname = @name;

            /* Mirror the LIS order form: MRNID is never blank — when the form
               supplied none, it backfills the patient id. The report download
               path dereferences MRNID, so a NULL here is what crashed Telo
               reports. */
            IF @mrnId IS NULL OR LTRIM(RTRIM(@mrnId)) = ''
                UPDATE dbo.tbl_med_mcc_patient_master
                SET MRNID = CONVERT(VARCHAR(50), @pid)
                WHERE id = @pid;
        END
        ELSE
        BEGIN
            SELECT @pname = name FROM dbo.tbl_med_mcc_patient_master
            WHERE id = @patientId AND mcc_code = @mcc;
            IF @pname IS NULL
            BEGIN
                IF @@TRANCOUNT > 0 ROLLBACK;
                SELECT ok = CAST(0 AS BIT), error_code = 'OUT_OF_SCOPE',
                       message = N'Patient not found in this collection centre',
                       patient_id = NULL, bill_id = NULL, bill_number = NULL,
                       total = @total, sample_count = 0;
                SELECT * FROM @emptySamples;
                RETURN;
            END
            SET @pid = @patientId;
        END

        /* ①b optional clinical-history PDF — mirrors the LIS, which stores
           the attachment in tbl_med_mcc_patient_clinicaldata with the literal
           filetype tag 'HISTORY', keyed by patient_id. */
        IF @clinicalFile IS NOT NULL AND DATALENGTH(@clinicalFile) > 0
            INSERT INTO dbo.tbl_med_mcc_patient_clinicaldata
                (binary_data, filene, filetype, patient_id, ADDEDDATE)
            VALUES
                (@clinicalFile, LEFT(ISNULL(@clinicalFileName, N'clinical-history.pdf'), 100),
                 'HISTORY', @pid, GETDATE());

        /* ② per-test rows (one per user-selected line).
           amount_checked / updateddate are deliberately left NULL — the order
           is NOT a sale yet. The LIS bills it when an operator clicks
           "Register" on the Accession screen (CheckTransCash sets
           amount_checked + updateddate and debits the franchise wallet).
           test_type uses the LIS enum ('Profile'/'Test'/'Master') so
           CheckTransCash — which matches those exact strings — recognises
           Telo's tests. A master profile is ONE row (test_type='Master',
           test_code=Master_Profile_Code, test_id=master id) billed once; its
           children are expanded only into sample rows below.
           @lines.testtype stays 'p'/'t'/'m' for the billing line items. */
        INSERT INTO dbo.tbl_med_mcc_patient_tests
            (patient_id, test_id, test_code, test_name, test_rate,
             test_type, addedby, addeddate, mobile_number)
        SELECT @pid, l.testMasterId, l.code, l.name, l.rate,
               CASE l.testtype WHEN 'p' THEN 'Profile' WHEN 'm' THEN 'Master' ELSE 'Test' END,
               CONCAT(N'telo:', @userId), GETDATE(), LEFT(@mobile, 12)
        FROM @lines l;

        /* ③ sample rows — ONE per distinct sample type.
           testtypes is the per-code type CSV ('t'/'p'), positionally aligned
           with testcodes — the LIS CheckTransCash uses it to route each code
           to its Test/Profile bucket when the order is Registered. */
        INSERT INTO dbo.tbl_med_mcc_patient_samples
            (patient_id, sampleid, testcodes, testnames, testtypes,
             vailid, sample_status, addedby, addeddate, modifieddate,
             lastmodified_date, business_unit_id, mobile_number)
        OUTPUT inserted.id, inserted.vailid, inserted.sampleid
            INTO @insertedSamples (sample_id, vailid, sampleid_db)
        SELECT @pid,
               NULLIF(g.sampleTypeId, -1) AS sampleid,  -- store NULL for Unspecified
               LEFT(g.csvCodes, 1000),
               LEFT(g.csvNames, 1000),
               LEFT(g.csvTypes, 500),
               s.vailid, 1, CONCAT(N'telo:', @userId), GETDATE(), GETDATE(),
               GETDATE(), @buCode, LEFT(@mobile, 12)
        FROM #groups g
        JOIN @sids s ON s.sampleTypeId = g.sampleTypeId;

        /* ④ bill header */
        EXEC dbo.usp_telo_next_bill_number
            @mcc = @mcc, @bill_number = @billNo OUTPUT,
            @ok = @o OUTPUT, @error_code = @ec OUTPUT;
        IF @o <> 1
        BEGIN
            IF @@TRANCOUNT > 0 ROLLBACK;
            SELECT ok = CAST(0 AS BIT), error_code = ISNULL(@ec,'INTERNAL'),
                   message = N'Could not reserve bill number',
                   patient_id = @pid, bill_id = NULL, bill_number = NULL,
                   total = @total, sample_count = @sampleCount;
            SELECT * FROM @emptySamples;
            RETURN;
        END

        /* ---- payment lines: prefer the @payments TVP (split payments);
           fall back to the legacy single scalar set for older callers. ----- */
        DECLARE @pay TABLE (
            seq    INT IDENTITY(1,1),
            method VARCHAR(50),
            amount INT,
            ref    NVARCHAR(50)
        );
        IF EXISTS (SELECT 1 FROM @payments)
            INSERT INTO @pay (method, amount, ref)
            SELECT COALESCE(NULLIF(LTRIM(RTRIM(method)), ''), 'Cash'),
                   amount,
                   NULLIF(LTRIM(RTRIM(ref)), N'')
            FROM @payments
            WHERE ISNULL(amount, 0) > 0;
        ELSE IF ISNULL(@receiptAmount, 0) > 0
            INSERT INTO @pay (method, amount, ref)
            VALUES (@paymentType, @receiptAmount, NULLIF(LTRIM(RTRIM(@paymentRef)), N''));

        DECLARE @paidTotal INT = (SELECT ISNULL(SUM(amount), 0) FROM @pay);
        DECLARE @methodCount INT = (SELECT COUNT(DISTINCT method) FROM @pay);
        /* The bill header has a single payment_type column the legacy LIS
           reads. Show the real method when one was used, 'Mixed' when the
           patient split across methods, else the legacy scalar (NULL when
           nothing was collected). Each individual receipt row below keeps its
           own real method. */
        DECLARE @headerPayType VARCHAR(50) =
            CASE WHEN @paidTotal = 0   THEN @paymentType
                 WHEN @methodCount > 1 THEN 'Mixed'
                 ELSE (SELECT TOP 1 method FROM @pay ORDER BY seq) END;

        DECLARE @balance INT = @total - ISNULL(@discountAmount,0) - @paidTotal;

        INSERT INTO dbo.tbl_billing_patient_detail
            (bill_number, bill_date, mcc_code, patientname, age, gender,
             medid, amount, discount_amount, amount_paid, Balance, payment_type,
             paymode, ref_doctor, ref_customer, mobile_number, email,
             age_type, noofpatients, addedby, addeddate)
        VALUES
            -- medid carries the patient_id for Telo orders so getOrder can
            -- join bill → patient → samples deterministically (medid is the
            -- LIS schema field for medical-record id; we repurpose it).
            (@billNo, GETDATE(), @mcc, LEFT(@pname,100), @age, @gender,
             CONVERT(VARCHAR(50), @pid),
             @total, ISNULL(@discountAmount,0), @paidTotal,
             @balance, @headerPayType, @payMode, @refDoctor, @refCustomer,
             LEFT(@mobile,10), LEFT(@email,50),
             CONVERT(VARCHAR(10), @ageType), 1,
             CONCAT(N'telo:', @userId), GETDATE());
        SET @billId = SCOPE_IDENTITY();

        /* ⑤ billing line items */
        INSERT INTO dbo.tbl_billing_patient_test_detail
            (billid, mcccode, testcode, testname, testamount, testtype)
        SELECT @billId, @mcc, LEFT(l.code,10), l.name, l.rate, l.testtype
        FROM @lines l;

        /* ⑥ receipts — ONE row per payment line (split payments supported:
           e.g. ₹500 Cash + ₹500 UPI = two receipt rows). Each receipt mints
           its own telo_txn id. */
        SET @txn = NULL;
        IF EXISTS (SELECT 1 FROM @pay)
        BEGIN
            -- card_number holds the operator-entered payment reference (UPI ref,
            -- cheque no., card auth code) for non-cash payments — same column the
            -- offline "record receipt" flow uses, so the ledger surfaces it.
            -- card_number is varchar(50); the ref is already trimmed to 50 in
            -- @pay, LEFT() again as belt-and-braces so a long ref can never
            -- throw a truncation error and fail the whole order.
            DECLARE @newReceipts TABLE (rid INT);
            INSERT INTO dbo.tbl_billing_patient_amount_receipt
                (bill_id, recd_date, amount, receivedby, receive_status, pay_mode,
                 card_number)
            OUTPUT inserted.id INTO @newReceipts (rid)
            SELECT @billId, GETDATE(), p.amount,
                   CONCAT(N'telo:', @userId), '1', p.method,
                   LEFT(p.ref, 50)
            FROM @pay p;

            -- One unique txn id per receipt. NEXT VALUE FOR in an INSERT…SELECT
            -- yields a distinct sequence value for each row.
            INSERT INTO dbo.telo_txn (receipt_id, bill_id, txn_id)
            SELECT nr.rid, @billId,
                   CONCAT(N'TXN',
                          RIGHT(CONCAT(N'00000000',
                                       CONVERT(VARCHAR(20), NEXT VALUE FOR dbo.telo_txn_seq)), 8))
            FROM @newReceipts nr;

            -- Status row returns the first txn id (preserves the prior single
            -- -receipt contract for callers that read txn_id).
            SELECT TOP 1 @txn = txn_id FROM dbo.telo_txn
            WHERE bill_id = @billId ORDER BY receipt_id;
        END

        /* NO franchise-wallet posting here. The LIS debits the franchise
           account when the order is moved Accessioning → Worksheet via the
           Accession screen's "Register" button (CheckTransCash). Posting it
           here too would double-debit. The bill header / line items / receipt
           above are Telo-internal records and are invisible to the LIS
           sales/ledger reports. */

        /* Tag B2B orders (billed at MRP) so the B2B worklist can list its own
           order type separately from New orders. Telo sidecar; regular orders
           stay untagged and are treated as 'new'. */
        IF @billAtMrp = 1
            INSERT INTO dbo.telo_order_kind (bill_id, kind) VALUES (@billId, N'b2b');

        COMMIT;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(400)),
               patient_id = @pid, bill_id = @billId, bill_number = @billNo,
               total = @total, sample_count = @sampleCount, txn_id = @txn;
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
               patient_id = CAST(NULL AS INT),
               bill_id = CAST(NULL AS INT),
               bill_number = CAST(NULL AS INT),
               total = @total, sample_count = 0;
        SELECT * FROM @emptySamples;
    END CATCH
END