/*
 * 104_usp_telo_edit_bill_tests.sql — audited "edit an order's tests".
 *
 * Replaces the ENTIRE test set of an existing Telo bill with a new set of LIS
 * tests (@items) and/or Telo-only custom lines (@customLines, with qty), then
 * recomputes the bill total + balance. Super-admin gated at the action layer.
 *
 * SCOPE (v1) — the bill must have NO samples yet (nothing accessioned). That is
 * the common correction window (a mis-registered order, before the lab draws a
 * sample) and it lets us rebuild the ordered-test rows cleanly WITHOUT having to
 * regenerate SIDs. A bill that already has samples is refused — cancel & re-book
 * (or cancel individual tests) instead. Gold-card bills are also refused (the
 * 50%-at-source maths would need re-deriving).
 *
 * Rebuild mirrors usp_telo_create_order exactly (same rate resolution, same
 * ordered-test rows, same custom line + log), so an edited bill is indistinguish-
 * able from one created that way. Payments/receipts are untouched — only the
 * tests and the derived amount/Balance change.
 *
 * Returns: { ok, error_code, message, balance }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_edit_bill_tests
    @billId       INT,
    @userId       INT,
    @items        dbo.TeloTestList  READONLY,
    @customLines  dbo.TeloCustomLine READONLY,
    @mrdText      NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @mcc INT, @pid INT, @addedby NVARCHAR(100), @discount INT, @paid INT,
            @rateTypeId INT, @buCode INT, @billAtMrp BIT = 0,
            @total INT = 0, @customTotal INT = 0, @bal INT;

    SELECT @mcc = mcc_code, @pid = TRY_CONVERT(INT, medid), @addedby = addedby,
           @discount = ISNULL(discount_amount, 0), @paid = ISNULL(amount_paid, 0)
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
               message = N'Only Telo-created bills can be edited here.',
               balance = CAST(NULL AS INT);
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM @items) AND NOT EXISTS (SELECT 1 FROM @customLines)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'An order needs at least one test or custom line.',
               balance = CAST(NULL AS INT);
        RETURN;
    END
    -- No samples yet: the safe edit window. Otherwise SIDs would need rework.
    IF EXISTS (SELECT 1 FROM dbo.tbl_med_mcc_patient_samples WHERE patient_id = @pid)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'HAS_SAMPLES',
               message = N'This order already has samples — cancel the tests or re-book it instead.',
               balance = CAST(NULL AS INT);
        RETURN;
    END
    IF EXISTS (SELECT 1 FROM dbo.telo_gold_card WHERE bill_id = @billId)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'GOLD_CARD',
               message = N'Gold Card bills can''t be edited here — re-book instead.',
               balance = CAST(NULL AS INT);
        RETURN;
    END

    SELECT @rateTypeId = RateType, @buCode = BusinessUnitCode
    FROM dbo.tbl_med_mcc_unit_master WHERE id = @mcc;
    -- B2B orders (billed at MRP) are tagged in telo_order_kind; keep that pricing.
    SET @billAtMrp = CASE WHEN EXISTS (SELECT 1 FROM dbo.telo_order_kind
                                       WHERE bill_id = @billId AND kind = N'b2b')
                          THEN 1 ELSE 0 END;

    /* rate-resolved @lines — identical resolution to usp_telo_create_order. */
    DECLARE @lines TABLE (
        rn INT IDENTITY(1,1), testMasterId INT, itemKind TINYINT,
        code NVARCHAR(50), name NVARCHAR(200), testtype CHAR(1), rate INT);

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
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Unknown or inactive test/profile/master id in the new set.',
               balance = CAST(NULL AS INT);
        RETURN;
    END

    SELECT @total = ISNULL(SUM(rate), 0) FROM @lines;
    SELECT @customTotal = ISNULL(SUM(unitAmount * qty), 0) FROM @customLines;
    SET @total = @total + @customTotal;

    BEGIN TRY
        BEGIN TRAN;

        /* ── remove the OLD test set (bill has no samples) ─────────────────── */
        -- test-cancellation audit rows referencing this bill's lines first.
        DELETE tc FROM dbo.telo_test_cancellation tc
        JOIN dbo.tbl_billing_patient_test_detail d ON d.id = tc.line_id
        WHERE d.billid = @billId;
        DELETE FROM dbo.telo_custom_test_order WHERE bill_id = @billId;
        DELETE FROM dbo.tbl_billing_patient_test_detail WHERE billid = @billId;
        DELETE FROM dbo.tbl_med_mcc_patient_tests WHERE patient_id = @pid;

        /* ── rebuild ordered-test rows (create_order ②) ────────────────────── */
        INSERT INTO dbo.tbl_med_mcc_patient_tests
            (patient_id, test_id, test_code, test_name, test_rate,
             test_type, addedby, addeddate)
        SELECT @pid, l.testMasterId, l.code, l.name, l.rate,
               CASE l.testtype WHEN 'p' THEN 'Profile' WHEN 'm' THEN 'Master' ELSE 'Test' END,
               CONCAT(N'telo:', @userId), GETDATE()
        FROM @lines l;

        /* ── rebuild billing line items (create_order ⑤) ───────────────────── */
        INSERT INTO dbo.tbl_billing_patient_test_detail
            (billid, mcccode, testcode, testname, testamount, testtype)
        SELECT @billId, @mcc, LEFT(l.code, 10), l.name, l.rate, l.testtype
        FROM @lines l;

        /* ── custom lines + traceability log (create_order ⑤b) ─────────────── */
        IF EXISTS (SELECT 1 FROM @customLines)
        BEGIN
            INSERT INTO dbo.tbl_billing_patient_test_detail
                (billid, mcccode, testcode, testname, testamount, testtype)
            SELECT @billId, @mcc, LEFT(c.code, 10),
                   LEFT(CASE WHEN c.qty > 1 THEN CONCAT(c.name, N' x', c.qty) ELSE c.name END, 200),
                   c.unitAmount * c.qty, 't'
            FROM @customLines c;

            INSERT INTO dbo.telo_custom_test_order
                (bill_id, patient_id, custom_test_id, code, name,
                 unit_amount, qty, mrd, mcc_code, created_by)
            SELECT @billId, @pid, c.customTestId, c.code, c.name,
                   c.unitAmount, c.qty,
                   NULLIF(LTRIM(RTRIM(@mrdText)), N''), @mcc,
                   CONCAT(N'telo:', @userId)
            FROM @customLines c;
        END

        /* ── recompute header amount + balance (payments untouched) ─────────── */
        UPDATE dbo.tbl_billing_patient_detail
        SET amount = @total,
            Balance = @total - @discount - @paid,
            updatedby = CONCAT(N'telo:', @userId),
            updateddate = GETDATE()
        WHERE id = @billId;

        SELECT @bal = Balance FROM dbo.tbl_billing_patient_detail WHERE id = @billId;
        COMMIT;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200)), balance = @bal;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200), balance = CAST(NULL AS INT);
    END CATCH
END
GO
