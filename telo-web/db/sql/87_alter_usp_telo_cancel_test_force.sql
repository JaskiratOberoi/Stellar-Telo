/*
 * 87_alter_usp_telo_cancel_test_force.sql
 *
 * Adds a backward-compatible @force BIT = 0 parameter to usp_telo_cancel_test.
 *
 * WHY: the accessioned-sample guard (sample_status > 1) and the master-package
 * guard correctly refuse a cancel when the sample is mid-processing in the LIS.
 * But when the LIS side has ALREADY disposed the test (marked SNR / TNP / Wrong
 * Booking and returned it to a non-reportable Pending state), Telo still needs
 * to record the cancellation so the bill total and refund line up. In that case
 * a super-admin passes @force = 1: it skips ONLY those two guards. Every other
 * safeguard (Telo-origin, valid-line, positive-amount, idempotency) still runs,
 * and the accounting (steps ①–⑤) is unchanged.
 *
 * NOTE: for an accessioned sample the SID-editing cursor (① ) already selects
 * nothing (it filters sample_status = 1), so a forced cancel touches only the
 * bill's own rows — never the LIS-managed SID/worksheet state.
 *
 * @force defaults to 0, so existing callers are unaffected. Idempotent deploy.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_cancel_test
    @billId INT,
    @lineId INT,
    @userId INT = NULL,
    @reason NVARCHAR(200) = NULL,
    @force  BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @addedby NVARCHAR(100), @pid INT, @discount INT, @paid INT,
            @lineBill INT, @code NVARCHAR(20), @name NVARCHAR(200),
            @amount INT, @testtype NVARCHAR(20), @mcc INT, @bal INT;

    SET @reason = NULLIF(LTRIM(RTRIM(ISNULL(@reason, N''))), N'');
    IF @reason IS NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'A reason is required to cancel a test.',
               balance = CAST(NULL AS INT);
        RETURN;
    END

    -- Bill must exist and be Telo-origin.
    SELECT @addedby = addedby, @pid = TRY_CONVERT(INT, medid),
           @discount = ISNULL(discount_amount, 0), @paid = ISNULL(amount_paid, 0),
           @mcc = mcc_code
    FROM dbo.tbl_billing_patient_detail WHERE id = @billId;
    IF @addedby IS NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Bill not found', balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @addedby NOT LIKE 'telo:%'
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Only tests on Telo-created bills can be cancelled here.',
               balance = CAST(NULL AS INT);
        RETURN;
    END

    -- Line must exist on this bill and be a real (positive) charge.
    SELECT @lineBill = billid, @code = LTRIM(RTRIM(testcode)), @name = testname,
           @amount = ISNULL(testamount, 0), @testtype = LTRIM(RTRIM(testtype))
    FROM dbo.tbl_billing_patient_test_detail WHERE id = @lineId;
    IF @lineBill IS NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Test line not found', balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @lineBill <> @billId
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Test line does not belong to this bill.',
               balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @amount <= 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'This line cannot be cancelled.',
               balance = CAST(NULL AS INT);
        RETURN;
    END

    -- Idempotent: a line can be cancelled once.
    IF EXISTS (SELECT 1 FROM dbo.telo_test_cancellation WHERE line_id = @lineId)
    BEGIN
        SELECT @bal = Balance FROM dbo.tbl_billing_patient_detail WHERE id = @billId;
        SELECT ok = CAST(0 AS BIT), error_code = 'ALREADY_CANCELLED',
               message = N'This test is already cancelled.', balance = @bal;
        RETURN;
    END

    -- Master packages aren't a single SID entry — cancel in the LIS.
    -- (@force = 1 skips this: LIS side already disposed the package.)
    IF @force = 0 AND @testtype IN ('m', 'M', 'Master')
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'MASTER_BLOCKED',
               message = N'Master packages must be cancelled in the LIS.',
               balance = CAST(NULL AS INT);
        RETURN;
    END

    -- Resolve the SID codes that represent THIS item: its own code (a direct
    -- test, or a single-sample profile that keeps its profile code as the SID
    -- token) plus, for a profile, its constituent test codes (a profile split
    -- across sample types stores its individual test codes instead). Onboarding
    -- is then judged against these codes only — so a test whose own sample type
    -- was never SID-tagged is NOT blocked just because the patient has other
    -- SIDs for other tests.
    DECLARE @itemCodes TABLE (code NVARCHAR(50) PRIMARY KEY);
    INSERT INTO @itemCodes (code) VALUES (@code);
    IF @testtype IN ('p', 'P', 'Profile')
    BEGIN
        DECLARE @testId INT = (
            SELECT TOP 1 test_id FROM dbo.tbl_med_mcc_patient_tests
            WHERE patient_id = @pid AND LTRIM(RTRIM(test_code)) = @code
            ORDER BY id);
        IF @testId IS NOT NULL
            INSERT INTO @itemCodes (code)
            SELECT DISTINCT CONVERT(NVARCHAR(50), t.TestCode)
            FROM dbo.tbl_med_test_profile_param pp
            JOIN dbo.tbl_med_test_master t ON t.id = pp.testid AND t.IsActive = 1
            WHERE pp.profileid = @testId
              AND CONVERT(NVARCHAR(50), t.TestCode) IS NOT NULL
              AND CONVERT(NVARCHAR(50), t.TestCode) NOT IN (SELECT code FROM @itemCodes);
    END

    -- Onboarding + status: which of the patient's samples carry any of this
    -- item's codes as a discrete token, and have any been accessioned?
    DECLARE @carrying INT, @accessioned INT;
    SELECT @carrying = COUNT(DISTINCT s.id),
           @accessioned = COUNT(DISTINCT CASE WHEN ISNULL(s.sample_status, 1) > 1 THEN s.id END)
    FROM dbo.tbl_med_mcc_patient_samples s
    WHERE s.patient_id = @pid
      AND EXISTS (SELECT 1 FROM @itemCodes ic
                  WHERE CONCAT(',', s.testcodes, ',') LIKE '%,' + ic.code + ',%');

    -- No SID carries this item → not onboarded → removable (no SID edit).
    -- (@force = 1 skips this: LIS side already disposed the accessioned sample.)
    IF @force = 0 AND @carrying > 0 AND @accessioned > 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'ACCESSIONED',
               message = N'This test''s sample has been accessioned and can no longer be cancelled here.',
               balance = CAST(NULL AS INT);
        RETURN;
    END

    DECLARE @editedSid NVARCHAR(50) = NULL, @editedSampleId INT = NULL;

    BEGIN TRY
        BEGIN TRAN;

        -- ① Pull the code out of each registered carrying SID's aligned CSVs,
        --    keeping the SID row. WHILE-loop split is encoding-safe and works on
        --    any SQL Server version (STRING_SPLIT's ordinal arg is 2022+).
        DECLARE @sampleId INT, @codes NVARCHAR(MAX), @names NVARCHAR(MAX),
                @types NVARCHAR(MAX), @vailid NVARCHAR(50);
        DECLARE sid_cur CURSOR LOCAL FAST_FORWARD FOR
            SELECT s.id, s.vailid, s.testcodes, s.testnames, s.testtypes
            FROM dbo.tbl_med_mcc_patient_samples s
            WHERE s.patient_id = @pid
              AND ISNULL(s.sample_status, 1) = 1
              AND EXISTS (SELECT 1 FROM @itemCodes ic
                          WHERE CONCAT(',', s.testcodes, ',') LIKE '%,' + ic.code + ',%');
        OPEN sid_cur;
        FETCH NEXT FROM sid_cur INTO @sampleId, @vailid, @codes, @names, @types;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            DECLARE @newCodes NVARCHAR(MAX) = N'', @newNames NVARCHAR(MAX) = N'',
                    @newTypes NVARCHAR(MAX) = N'';
            DECLARE @c NVARCHAR(MAX) = ISNULL(@codes, N'') + N',',
                    @n NVARCHAR(MAX) = ISNULL(@names, N'') + N',',
                    @t NVARCHAR(MAX) = ISNULL(@types, N'') + N',';
            WHILE LEN(@c) > 0
            BEGIN
                DECLARE @ci INT = CHARINDEX(N',', @c),
                        @ni INT = CHARINDEX(N',', @n),
                        @ti INT = CHARINDEX(N',', @t);
                DECLARE @code1 NVARCHAR(MAX) = LEFT(@c, @ci - 1),
                        @name1 NVARCHAR(MAX) = CASE WHEN @ni > 0 THEN LEFT(@n, @ni - 1) ELSE N'' END,
                        @type1 NVARCHAR(MAX) = CASE WHEN @ti > 0 THEN LEFT(@t, @ti - 1) ELSE N'' END;
                IF NOT EXISTS (SELECT 1 FROM @itemCodes ic WHERE ic.code = LTRIM(RTRIM(@code1)))
                BEGIN
                    SET @newCodes = CASE WHEN @newCodes = N'' THEN @code1 ELSE @newCodes + N',' + @code1 END;
                    SET @newNames = CASE WHEN @newNames = N'' THEN @name1 ELSE @newNames + N',' + @name1 END;
                    SET @newTypes = CASE WHEN @newTypes = N'' THEN @type1 ELSE @newTypes + N',' + @type1 END;
                END
                SET @c = STUFF(@c, 1, @ci, N'');
                SET @n = CASE WHEN @ni > 0 THEN STUFF(@n, 1, @ni, N'') ELSE N'' END;
                SET @t = CASE WHEN @ti > 0 THEN STUFF(@t, 1, @ti, N'') ELSE N'' END;
            END

            UPDATE dbo.tbl_med_mcc_patient_samples
            SET testcodes = LEFT(@newCodes, 1000),
                testnames = LEFT(@newNames, 1000),
                testtypes = LEFT(@newTypes, 500),
                modifieddate = GETDATE(),
                lastmodified_date = GETDATE()
            WHERE id = @sampleId;

            IF @editedSid IS NULL
            BEGIN
                SET @editedSid = @vailid;
                SET @editedSampleId = @sampleId;
            END

            FETCH NEXT FROM sid_cur INTO @sampleId, @vailid, @codes, @names, @types;
        END
        CLOSE sid_cur;
        DEALLOCATE sid_cur;

        -- ② Remove the ordered-test row so the LIS won't process it.
        DELETE TOP (1) FROM dbo.tbl_med_mcc_patient_tests
        WHERE patient_id = @pid AND LTRIM(RTRIM(test_code)) = @code;

        -- ③ Negative offset bill line (original line kept for the trail).
        INSERT INTO dbo.tbl_billing_patient_test_detail
            (billid, mcccode, testcode, testname, testamount, testtype)
        VALUES
            (@billId, @mcc, LEFT(@code, 10),
             LEFT(CONCAT(@name, N' (Cancelled)'), 200), -@amount, 't');

        -- ④ Recompute header amount + balance from the (now net) line items.
        DECLARE @newAmount INT =
            (SELECT ISNULL(SUM(testamount), 0)
             FROM dbo.tbl_billing_patient_test_detail WHERE billid = @billId);
        UPDATE dbo.tbl_billing_patient_detail
        SET amount = @newAmount,
            Balance = @newAmount - @discount - @paid,
            updatedby = CONCAT(N'telo:', ISNULL(@userId, 0)),
            updateddate = GETDATE()
        WHERE id = @billId;

        -- ⑤ Audit trail row.
        INSERT INTO dbo.telo_test_cancellation
            (bill_id, patient_id, line_id, test_code, test_name, amount,
             sid, sample_id, cancelled_by, reason)
        VALUES
            (@billId, @pid, @lineId, @code, @name, @amount,
             @editedSid, @editedSampleId, @userId, @reason);

        SELECT @bal = Balance FROM dbo.tbl_billing_patient_detail WHERE id = @billId;

        COMMIT;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200)), balance = @bal;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        -- Defensive: ensure the cursor is closed on error.
        IF CURSOR_STATUS('local', 'sid_cur') >= 0
        BEGIN
            CLOSE sid_cur;
            DEALLOCATE sid_cur;
        END
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200), balance = CAST(NULL AS INT);
    END CATCH
END
GO
