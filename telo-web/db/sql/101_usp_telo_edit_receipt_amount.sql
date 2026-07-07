/*
 * 101_usp_telo_edit_receipt_amount.sql
 *
 * EDITS the amount of a single already-recorded receipt (payment OR refund) on
 * an existing Telo bill. Super-admin-gated at the action layer; this proc also
 * refuses non-Telo bills, receipts that don't belong to @billId, voided
 * receipts, non-positive amounts and blank reasons.
 *
 * The receipt row keeps its id, telo_txn number, recd_date, pay_mode and
 * reference EXACTLY as recorded — only `amount` is updated in place, so every
 * read that sums receipts is automatically consistent. The bill's
 * amount_paid / Balance shift by the delta (@newAmount - old):
 *   - payment (receive_status='1'):  amount_paid += delta,  Balance -= delta
 *   - refund  (receive_status='2'):  amount_paid -= delta,  Balance += delta
 * One row is appended to dbo.telo_receipt_edit per edit (who / when / from →
 * to / why), so the order page can show the "modified" badge and the full
 * trail survives repeat edits.
 *
 * Editing to the current amount is a no-op that returns ok with unchanged=1.
 *
 * Returns { ok, error_code, message, unchanged BIT, old_amount INT, balance INT }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_edit_receipt_amount
    @receiptId INT,
    @billId    INT,
    @newAmount INT,
    @userId    INT = NULL,
    @reason    NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @old INT, @status VARCHAR(2), @rbill INT, @addedby NVARCHAR(100),
            @bal INT, @delta INT,
            @cleanReason NVARCHAR(200) = NULLIF(LTRIM(RTRIM(ISNULL(@reason, N''))), N'');

    IF @cleanReason IS NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'A reason is required to edit a transaction amount.',
               unchanged = CAST(0 AS BIT), old_amount = CAST(NULL AS INT),
               balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @newAmount IS NULL OR @newAmount <= 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'The new amount must be a positive number.',
               unchanged = CAST(0 AS BIT), old_amount = CAST(NULL AS INT),
               balance = CAST(NULL AS INT);
        RETURN;
    END

    SELECT @old = r.amount, @status = r.receive_status, @rbill = r.bill_id
    FROM dbo.tbl_billing_patient_amount_receipt r
    WHERE r.id = @receiptId;

    IF @@ROWCOUNT = 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Receipt not found',
               unchanged = CAST(0 AS BIT), old_amount = CAST(NULL AS INT),
               balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @rbill <> @billId
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Receipt does not belong to this bill.',
               unchanged = CAST(0 AS BIT), old_amount = CAST(NULL AS INT),
               balance = CAST(NULL AS INT);
        RETURN;
    END

    SELECT @addedby = addedby, @bal = ISNULL(Balance, 0)
    FROM dbo.tbl_billing_patient_detail WHERE id = @billId;
    IF @addedby IS NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Bill not found',
               unchanged = CAST(0 AS BIT), old_amount = CAST(NULL AS INT),
               balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @addedby NOT LIKE 'telo:%'
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Only receipts on Telo-created bills can be edited.',
               unchanged = CAST(0 AS BIT), old_amount = CAST(NULL AS INT),
               balance = CAST(NULL AS INT);
        RETURN;
    END

    -- A voided receipt no longer counts toward amount_paid, and the void row
    -- snapshots the amount as it was — editing it now would corrupt both.
    IF EXISTS (SELECT 1 FROM dbo.telo_receipt_void WHERE receipt_id = @receiptId)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'This transaction is voided and cannot be edited.',
               unchanged = CAST(0 AS BIT), old_amount = @old,
               balance = @bal;
        RETURN;
    END

    -- No-op: the amount is already what was asked for.
    IF @newAmount = @old
    BEGIN
        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = N'Amount unchanged',
               unchanged = CAST(1 AS BIT), old_amount = @old, balance = @bal;
        RETURN;
    END

    SET @delta = @newAmount - @old;

    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO dbo.telo_receipt_edit
            (receipt_id, bill_id, old_amount, new_amount, edited_by, reason)
        VALUES
            (@receiptId, @billId, @old, @newAmount, @userId, @cleanReason);

        -- Amount only — id, telo_txn number, recd_date, pay_mode and the
        -- reference stay exactly as originally recorded.
        UPDATE dbo.tbl_billing_patient_amount_receipt
        SET amount = @newAmount
        WHERE id = @receiptId;

        UPDATE dbo.tbl_billing_patient_detail
        SET amount_paid = CASE WHEN @status = '2'
                               THEN ISNULL(amount_paid, 0) - @delta
                               ELSE ISNULL(amount_paid, 0) + @delta END,
            Balance     = CASE WHEN @status = '2'
                               THEN ISNULL(Balance, amount) + @delta
                               ELSE ISNULL(Balance, amount) - @delta END,
            updatedby   = CONCAT(N'telo:', ISNULL(@userId, 0)),
            updateddate = GETDATE()
        WHERE id = @billId;

        SELECT @bal = Balance FROM dbo.tbl_billing_patient_detail WHERE id = @billId;

        COMMIT;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200)),
               unchanged = CAST(0 AS BIT), old_amount = @old, balance = @bal;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200),
               unchanged = CAST(0 AS BIT), old_amount = CAST(NULL AS INT),
               balance = CAST(NULL AS INT);
    END CATCH
END
GO
