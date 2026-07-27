/*
 * 67_usp_telo_accession_samples.sql — Telo-side "Register" (accessioning).
 *
 * A faithful T-SQL port of the LIS Accession screen's Register action:
 *   MedCis.UI/Worksheet/Accession.aspx.cs      btnSave_Click  (chkRegister)
 *   MedCis.Business/Pcc/WorksheetClass.cs      GetTestsBySampleId
 *                                              LoadTestByVailId
 *                                              LoadProfileTestsByVailId
 *                                              GetTestNormalRanges / GetTestUnits
 *                                              UpdateSampleStatus
 *
 * WHAT REGISTER DOES (per SID), in the LIS's own order:
 *   ① If the SID has NO result rows yet, build the "empty result skeleton" by
 *      walking the sample's testtypes/testcodes CSVs POSITIONALLY:
 *        'p' | 'mp' -> profile expansion   (Profile head + Head/Param/Test rows)
 *        't' | 'mt' -> single test         (Head + Param rows, or one Test row)
 *      Normal ranges and units are resolved PER PATIENT (age band + gender).
 *   ② Flip the sample to sample_status = 2 ('Sample Registered'), stamp
 *      modifiedby/modifieddate, set the patient master Status = 2, and derive
 *      report_type from the generated test names.
 * Only then does the sample clear the worksheet SP's `sample_status > 1` gate.
 *
 * DELIBERATE FIDELITY NOTES (these mirror LIS quirks — do not "fix" them):
 *  - `mobile_number` on a result row holds GET_SAMPLE_VALUE (a machine default
 *    value), NOT a phone number. The LIS overloads the column; the report
 *    reader depends on it.
 *  - A parameter row's `testid` is the PARAM's `TestCode` column, which is the
 *    parent test master's id (not a test code string).
 *  - 'Head'/'Profile' rows carry auth = 1; real result rows carry auth = 0.
 *  - Head rows have testcode = '' (empty string, not NULL).
 *  - Units are taken from the FIRST normal-range row with a non-empty unit,
 *    ignoring age/gender — unlike the range itself.
 *
 * Idempotent per SID: a SID that already has result rows keeps them (the LIS
 * short-circuits the same way), and a SID not at status 1 is skipped.
 *
 * Returns: status row { ok, error_code, message, registered, skipped }
 *          detail rows { vailid, outcome, result_rows }
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_accession_samples
    @userId  INT,
    @user    NVARCHAR(50),      -- LIS username, stamped into modifiedby
    @vailids dbo.TeloVailidList READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @out TABLE (
        vailid NVARCHAR(50), outcome VARCHAR(20), result_rows INT
    );

    IF NOT EXISTS (SELECT 1 FROM @vailids)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'No Sample IDs supplied', registered = 0, skipped = 0;
        SELECT * FROM @out;
        RETURN;
    END

    /* Resolve the batch to real, still-unregistered samples. */
    DECLARE @work TABLE (
        vailid NVARCHAR(50) PRIMARY KEY, sample_id INT, patient_id INT,
        testcodes NVARCHAR(1000), testtypes NVARCHAR(500),
        modifieddate DATETIME, age INT, age_type INT, gender INT
    );
    INSERT INTO @work
    SELECT DISTINCT s.vailid, s.id, s.patient_id, s.testcodes, s.testtypes,
           s.modifieddate, p.age, p.age_type, p.gender
    FROM @vailids v
    JOIN dbo.tbl_med_mcc_patient_samples s ON s.vailid = v.vailid
    JOIN dbo.tbl_med_mcc_patient_master p ON p.id = s.patient_id
    WHERE s.sample_status = 1;      -- LIS: only 'Sample Sent' is registerable

    /* Anything not picked up is reported back rather than silently dropped. */
    INSERT INTO @out (vailid, outcome, result_rows)
    SELECT v.vailid, 'skipped', 0
    FROM (SELECT DISTINCT vailid FROM @vailids) v
    WHERE NOT EXISTS (SELECT 1 FROM @work w WHERE w.vailid = v.vailid);

    IF NOT EXISTS (SELECT 1 FROM @work)
    BEGIN
        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = N'Nothing to register — already accessioned or not found',
               registered = 0, skipped = (SELECT COUNT(*) FROM @out);
        SELECT * FROM @out;
        RETURN;
    END

    /* ── Positional split of the testcodes/testtypes CSV pair ─────────────
       OPENJSON preserves ordinal position ([key]); STRING_SPLIT did not
       guarantee order on this server's compat level. The two CSVs are written
       in lockstep by usp_telo_create_order / usp_telo_add_sids. */
    DECLARE @items TABLE (
        vailid NVARCHAR(50), pos INT, code NVARCHAR(100), ttype VARCHAR(10)
    );
    INSERT INTO @items (vailid, pos, code, ttype)
    SELECT w.vailid, c.[key], LTRIM(RTRIM(c.value)), LTRIM(RTRIM(t.value))
    FROM @work w
    CROSS APPLY OPENJSON('["' + REPLACE(REPLACE(w.testcodes, '"', ''), ',', '","') + '"]') c
    CROSS APPLY OPENJSON('["' + REPLACE(REPLACE(w.testtypes, '"', ''), ',', '","') + '"]') t
    WHERE t.[key] = c.[key]
      AND LTRIM(RTRIM(c.value)) <> '';

    /* Skeleton rows are staged here, then inserted in display order. */
    DECLARE @rows TABLE (
        seq INT IDENTITY(1,1) PRIMARY KEY,
        vailid NVARCHAR(50), patientid INT, sortkey INT, sub INT,
        testid INT, paramid INT, testcode VARCHAR(50), testname NVARCHAR(400),
        testtype VARCHAR(10), testnormal_range VARCHAR(1000), testunit VARCHAR(50),
        auth BIT, attachment BIT, profile_id INT, updateddate DATETIME,
        machine_value NVARCHAR(400)
    );

    /* ═══ ① 't' / 'mt' — a single test ═══════════════════════════════════ */

    /* 1a. Parameterised test -> one 'Head' row, then its parameter rows. */
    INSERT INTO @rows (vailid, patientid, sortkey, sub, testid, paramid, testcode,
                       testname, testtype, testnormal_range, testunit, auth,
                       attachment, profile_id, updateddate, machine_value)
    SELECT w.vailid, w.patient_id, i.pos, 0,
           tm.id, NULL, '',                       -- LIS: Head testcode = ''
           tm.ReportTestname, 'Head', NULL, NULL, 1,
           tm.Has_graph, NULL,
           DATEADD(HOUR, CASE WHEN tm.TAT > 0 THEN tm.TAT ELSE 5 END, w.modifieddate),
           NULL
    FROM @work w
    JOIN @items i ON i.vailid = w.vailid AND i.ttype IN ('t', 'mt')
    CROSS APPLY (
        SELECT TOP 1 * FROM dbo.tbl_med_test_master m
        WHERE m.TestCode = i.code ORDER BY m.id
    ) tm
    WHERE tm.Has_Parameters = 1;

    INSERT INTO @rows (vailid, patientid, sortkey, sub, testid, paramid, testcode,
                       testname, testtype, testnormal_range, testunit, auth,
                       attachment, profile_id, updateddate, machine_value)
    SELECT w.vailid, w.patient_id, i.pos, pm.Orderno,
           pm.TestCode,                            -- LIS: param's TestCode = test master id
           pm.id, tm.TestCode, pm.Name,
           CASE WHEN pm.shortname IN ('Param', 'Head') THEN pm.shortname ELSE 'Param' END,
           dbo.ufn_telo_param_normal_range(pm.id, w.age, w.age_type, w.gender),
           dbo.ufn_telo_param_unit(pm.TestCode, pm.id),
           0, NULL, NULL, NULL,
           dbo.ufn_telo_sample_value(pm.TestCode, pm.id)
    FROM @work w
    JOIN @items i ON i.vailid = w.vailid AND i.ttype IN ('t', 'mt')
    CROSS APPLY (
        SELECT TOP 1 * FROM dbo.tbl_med_test_master m
        WHERE m.TestCode = i.code ORDER BY m.id
    ) tm
    JOIN dbo.tbl_med_parameter_master pm
      ON pm.TestCode = tm.id AND pm.IsActive = 1
    WHERE tm.Has_Parameters = 1;

    /* 1b. Plain test -> a single 'Test' row. */
    INSERT INTO @rows (vailid, patientid, sortkey, sub, testid, paramid, testcode,
                       testname, testtype, testnormal_range, testunit, auth,
                       attachment, profile_id, updateddate, machine_value)
    SELECT w.vailid, w.patient_id, i.pos, 1,
           tm.id, NULL, tm.TestCode, tm.ReportTestname, 'Test',
           dbo.ufn_telo_test_normal_range(tm.id, w.age, w.age_type, w.gender),
           dbo.ufn_telo_test_unit(tm.id),
           0, tm.Has_graph, NULL,
           DATEADD(HOUR, CASE WHEN tm.TAT > 0 THEN tm.TAT ELSE 5 END, w.modifieddate),
           dbo.ufn_telo_sample_value(tm.id, NULL)
    FROM @work w
    JOIN @items i ON i.vailid = w.vailid AND i.ttype IN ('t', 'mt')
    JOIN dbo.tbl_med_test_master tm ON tm.TestCode = i.code
    WHERE ISNULL(tm.Has_Parameters, 0) = 0;

    /* ═══ ② 'p' / 'mp' — a profile ═══════════════════════════════════════ */

    /* Resolve profile code -> profile id, and its constituent tests. */
    DECLARE @prof TABLE (
        vailid NVARCHAR(50), pos INT, profileid INT, testid INT, orderno INT,
        firstprofileid INT, firsttestid INT
    );
    INSERT INTO @prof
    SELECT w.vailid, i.pos, pm.id, pp.testid, ISNULL(tmm.OrderNo, 0),
           pm.id,
           (SELECT TOP 1 pp2.testid FROM dbo.tbl_med_test_profile_param pp2
            WHERE pp2.profileid = pm.id ORDER BY pp2.id)
    FROM @work w
    JOIN @items i ON i.vailid = w.vailid AND i.ttype IN ('p', 'mp')
    JOIN dbo.tbl_med_test_profile_master pm ON pm.Profile_Code = i.code
    JOIN dbo.tbl_med_test_profile_param pp ON pp.profileid = pm.id
    LEFT JOIN dbo.tbl_med_test_master tmm ON tmm.id = pp.testid;

    /* 2a. Parameterised constituent -> 'Head' + its parameter rows. */
    INSERT INTO @rows (vailid, patientid, sortkey, sub, testid, paramid, testcode,
                       testname, testtype, testnormal_range, testunit, auth,
                       attachment, profile_id, updateddate, machine_value)
    SELECT w.vailid, w.patient_id, pr.pos, pr.orderno * 1000,
           pr.testid, NULL, '', tm.ReportTestname, 'Head', NULL, NULL, 1,
           NULL, pr.firstprofileid,
           DATEADD(HOUR, CASE WHEN tm.TAT > 0 THEN tm.TAT ELSE 5 END, w.modifieddate),
           NULL
    FROM @work w
    JOIN @prof pr ON pr.vailid = w.vailid
    JOIN dbo.tbl_med_test_master tm ON tm.id = pr.testid
    WHERE tm.Has_Parameters = 1;

    INSERT INTO @rows (vailid, patientid, sortkey, sub, testid, paramid, testcode,
                       testname, testtype, testnormal_range, testunit, auth,
                       attachment, profile_id, updateddate, machine_value)
    SELECT w.vailid, w.patient_id, pr.pos, pr.orderno * 1000 + pm.Orderno + 1,
           pm.TestCode, pm.id, tm.TestCode, pm.Name,
           CASE WHEN pm.shortname IN ('Param', 'Head') THEN pm.shortname ELSE 'Param' END,
           dbo.ufn_telo_param_normal_range(pm.id, w.age, w.age_type, w.gender),
           dbo.ufn_telo_param_unit(pm.TestCode, pm.id),
           0, NULL, pr.firstprofileid, NULL,
           dbo.ufn_telo_sample_value(pm.TestCode, pm.id)
    FROM @work w
    JOIN @prof pr ON pr.vailid = w.vailid
    JOIN dbo.tbl_med_test_master tm ON tm.id = pr.testid
    JOIN dbo.tbl_med_parameter_master pm
      ON pm.TestCode = tm.id AND pm.IsActive = 1
    WHERE tm.Has_Parameters = 1;

    /* 2b. Plain constituent -> a single 'Test' row. */
    INSERT INTO @rows (vailid, patientid, sortkey, sub, testid, paramid, testcode,
                       testname, testtype, testnormal_range, testunit, auth,
                       attachment, profile_id, updateddate, machine_value)
    SELECT w.vailid, w.patient_id, pr.pos, pr.orderno * 1000,
           tm.id, NULL, tm.TestCode, tm.ReportTestname, 'Test',
           dbo.ufn_telo_test_normal_range(tm.id, w.age, w.age_type, w.gender),
           dbo.ufn_telo_test_unit(tm.id),
           0, tm.Has_graph, pr.firstprofileid,
           DATEADD(HOUR, CASE WHEN tm.TAT > 0 THEN tm.TAT ELSE 5 END, w.modifieddate),
           dbo.ufn_telo_sample_value(tm.id, NULL)
    FROM @work w
    JOIN @prof pr ON pr.vailid = w.vailid
    JOIN dbo.tbl_med_test_master tm ON tm.id = pr.testid
    WHERE ISNULL(tm.Has_Parameters, 0) = 0;

    /* 2c. Profile header — only when the profile produced Test/Param rows
           (LIS: `lsttests > 0`). sub = -1 sorts it above its own block. */
    INSERT INTO @rows (vailid, patientid, sortkey, sub, testid, paramid, testcode,
                       testname, testtype, testnormal_range, testunit, auth,
                       attachment, profile_id, updateddate, machine_value)
    SELECT DISTINCT w.vailid, w.patient_id, pr.pos, -1,
           pr.firsttestid, NULL, NULL, pfm.Profile_Name, 'Profile',
           NULL, NULL, 1, NULL, pr.firstprofileid, NULL, NULL
    FROM @work w
    JOIN @prof pr ON pr.vailid = w.vailid
    JOIN dbo.tbl_med_test_profile_master pfm ON pfm.id = pr.profileid
    WHERE EXISTS (
        SELECT 1 FROM @rows r
        WHERE r.vailid = w.vailid AND r.sortkey = pr.pos
          AND r.testtype IN ('Test', 'Param')
    );

    /* ═══ ③ Persist ══════════════════════════════════════════════════════ */
    BEGIN TRY
        BEGIN TRAN;

        /* Skeleton — only for SIDs with no existing result rows (LIS
           short-circuits when any row already exists for the vailid). */
        INSERT INTO dbo.tbl_med_mcc_patient_test_result
            (patientid, vailid, testid, paramid, testcode, testname, testtype,
             testnormal_range, testunit, auth, attachment, profile_id,
             addeddate, updateddate, mobile_number)
        SELECT r.patientid, r.vailid, r.testid, r.paramid, r.testcode, r.testname,
               r.testtype, r.testnormal_range, r.testunit, r.auth, r.attachment,
               r.profile_id, GETDATE(), r.updateddate, r.machine_value
        FROM @rows r
        WHERE NOT EXISTS (
            SELECT 1 FROM dbo.tbl_med_mcc_patient_test_result x
            WHERE x.vailid = r.vailid
        )
        ORDER BY r.vailid, r.sortkey, r.sub, r.seq;

        /* Sample -> 'Sample Registered', plus the LIS's report_type rule. */
        UPDATE s
        SET s.sample_status = 2,
            s.modifiedby = @user,
            s.modifieddate = GETDATE(),
            s.lastmodified_date = GETDATE(),
            s.report_type = CASE
                WHEN EXISTS (SELECT 1 FROM dbo.tbl_med_mcc_patient_test_result r
                             WHERE r.vailid = s.vailid
                               AND UPPER(r.testname) LIKE '%THYROID PROFILE I%') THEN 1
                WHEN EXISTS (SELECT 1 FROM dbo.tbl_med_mcc_patient_test_result r
                             WHERE r.vailid = s.vailid
                               AND UPPER(r.testname) LIKE '%ANTIBIOGRAM%') THEN 2
                ELSE s.report_type END
        FROM dbo.tbl_med_mcc_patient_samples s
        JOIN @work w ON w.vailid = s.vailid
        WHERE s.sample_status = 1;

        /* Patient master follows the sample (LIS: patient_master.Status = 2). */
        UPDATE p
        SET p.Status = 2
        FROM dbo.tbl_med_mcc_patient_master p
        JOIN (SELECT DISTINCT patient_id FROM @work) w ON w.patient_id = p.id;

        INSERT INTO @out (vailid, outcome, result_rows)
        SELECT w.vailid, 'registered',
               (SELECT COUNT(*) FROM dbo.tbl_med_mcc_patient_test_result r
                WHERE r.vailid = w.vailid)
        FROM @work w;

        COMMIT;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(400)),
               registered = (SELECT COUNT(*) FROM @out WHERE outcome = 'registered'),
               skipped    = (SELECT COUNT(*) FROM @out WHERE outcome = 'skipped');
        SELECT * FROM @out;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 400), registered = 0,
               skipped = (SELECT COUNT(*) FROM @out);
        SELECT * FROM @out;
    END CATCH
END
