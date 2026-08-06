/*
 * 83_usp_telo_void_receipt.sql
 *
 * VOIDS a single receipt (payment OR refund) on an existing Telo bill, without
 * hard-deleting it. Super-admin-gated at the action layer; this proc also
 * refuses non-Telo bills and a receipt that doesn't belong to @billId.
 *
 * Effect (the exact reverse of how the row was posted):
 *   - payment (receive_status='1'):  amount_paid -= amount,  Balance += amount
 *   - refund  (receive_status='2'):  amount_paid += amount,  Balance -= amount
 * The receipt row and its telo_txn id are LEFT IN PLACE; one row is written to
 * dbo.telo_receipt_void so every reporting read can exclude it (NOT EXISTS) and
 * the order page can show it struck through.
 *
 * Idempotent: voiding an already-voided receipt is a no-op that returns ok with
 * already_voided=1 and the current balance.
 *
 * Returns { ok, error_code, message, already_voided BIT, balance INT }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_void_receipt
    @receiptId INT,
    @billId    INT,
    @userId    INT = NULL,
    @reason    NVARCHAR(200) = NULL,
    -- Origin marker prefix stamped into addedby/updatedby/lastupdatedby, as
    -- '<origin><userId>'. Defaulted to 'telo:' so every existing Telo caller
    -- behaves exactly as before. Stellar Infinity passes 'inf:'.
    @origin NVARCHAR(20) = N'telo:'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @amount INT, @status VARCHAR(2), @rbill INT, @addedby NVARCHAR(100), @bal INT;

    SELECT @amount = r.amount, @status = r.receive_status, @rbill = r.bill_id
    FROM dbo.tbl_billing_patient_amount_receipt r
    WHERE r.id = @receiptId;

    IF @@ROWCOUNT = 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Receipt not found',
               already_voided = CAST(0 AS BIT), balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @rbill <> @billId
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Receipt does not belong to this bill.',
               already_voided = CAST(0 AS BIT), balance = CAST(NULL AS INT);
        RETURN;
    END

    SELECT @addedby = addedby, @bal = ISNULL(Balance, 0)
    FROM dbo.tbl_billing_patient_detail WHERE id = @billId;
    IF @addedby IS NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Bill not found',
               already_voided = CAST(0 AS BIT), balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @addedby NOT LIKE 'telo:%' AND @addedby NOT LIKE 'inf:%'
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Only receipts on Telo-created bills can be voided.',
               already_voided = CAST(0 AS BIT), balance = CAST(NULL AS INT);
        RETURN;
    END

    -- Idempotent: already voided â†’ no-op, report current balance.
    IF EXISTS (SELECT 1 FROM dbo.telo_receipt_void WHERE receipt_id = @receiptId)
    BEGIN
        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = N'Receipt already voided',
               already_voided = CAST(1 AS BIT), balance = @bal;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO dbo.telo_receipt_void
            (receipt_id, bill_id, amount, receive_status, voided_by, reason)
        VALUES
            (@receiptId, @billId, @amount, @status, @userId,
             NULLIF(LTRIM(RTRIM(ISNULL(@reason, N''))), N''));

        UPDATE dbo.tbl_billing_patient_detail
        SET amount_paid = CASE WHEN @status = '2'
                               THEN ISNULL(amount_paid, 0) + @amount
                               ELSE ISNULL(amount_paid, 0) - @amount END,
            Balance     = CASE WHEN @status = '2'
                               THEN ISNULL(Balance, amount) - @amount
                               ELSE ISNULL(Balance, amount) + @amount END,
            updatedby   = CONCAT(@origin, ISNULL(@userId, 0)),
            updateddate = GETDATE()
        WHERE id = @billId;

        SELECT @bal = Balance FROM dbo.tbl_billing_patient_detail WHERE id = @billId;

        COMMIT;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200)),
               already_voided = CAST(0 AS BIT), balance = @bal;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200),
               already_voided = CAST(0 AS BIT), balance = CAST(NULL AS INT);
    END CATCH
END
GO
