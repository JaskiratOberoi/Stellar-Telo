/*
 * 88_alter_usp_telo_record_receipt_ignore_voided.sql
 *
 * Bug fix: the @gatewayRef idempotency guard in usp_telo_record_receipt matched
 * ANY receipt on the bill carrying that card_number — including VOIDED ones.
 * So once a txn reference was voided (e.g. an operator mis-keyed the amount,
 * voided the receipt, and re-entered the payment with the SAME UPI/UTR ref),
 * re-recording was silently swallowed as "already recorded" and nothing was
 * inserted — the page just refreshed with no new payment.
 *
 * Fix: both the idempotency EXISTS and the already-recorded txn lookup now
 * exclude receipts present in dbo.telo_receipt_void. A LIVE receipt with the
 * same gateway ref still no-ops (webhook-retry safety is preserved); a VOIDED
 * one no longer blocks re-use of its reference.
 *
 * Only these two predicates changed; the insert/ledger logic is untouched.
 * Idempotent deploy (CREATE OR ALTER).
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_record_receipt
    @billId      INT,
    @amount      INT,
    @payMode     VARCHAR(50)  = N'Online',
    @gatewayRef  VARCHAR(100) = NULL,
    @userId      INT          = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @bal INT, @rid INT, @txn VARCHAR(24);

    IF NOT EXISTS (SELECT 1 FROM dbo.tbl_billing_patient_detail WHERE id = @billId)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Unknown bill', already_recorded = CAST(0 AS BIT),
               balance = CAST(NULL AS INT), txn_id = CAST(NULL AS VARCHAR(24));
        RETURN;
    END

    -- Idempotency: same gateway payment id already captured on a LIVE receipt.
    -- Voided receipts are excluded so a re-keyed payment can reuse the ref.
    IF @gatewayRef IS NOT NULL AND EXISTS (
        SELECT 1 FROM dbo.tbl_billing_patient_amount_receipt r
        WHERE r.bill_id = @billId AND r.card_number = @gatewayRef
          AND NOT EXISTS (SELECT 1 FROM dbo.telo_receipt_void v
                          WHERE v.receipt_id = r.id))
    BEGIN
        SELECT @bal = Balance FROM dbo.tbl_billing_patient_detail WHERE id = @billId;
        SELECT @txn = t.txn_id
        FROM dbo.telo_txn t
        JOIN dbo.tbl_billing_patient_amount_receipt r ON r.id = t.receipt_id
        WHERE r.bill_id = @billId AND r.card_number = @gatewayRef
          AND NOT EXISTS (SELECT 1 FROM dbo.telo_receipt_void v
                          WHERE v.receipt_id = r.id);
        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = N'Already recorded', already_recorded = CAST(1 AS BIT),
               balance = @bal, txn_id = @txn;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO dbo.tbl_billing_patient_amount_receipt
            (bill_id, recd_date, amount, receivedby, receive_status,
             pay_mode, card_number)
        VALUES
            (@billId, GETDATE(), @amount,
             CONCAT(N'telo:', ISNULL(@userId, 0)), '1',
             @payMode, @gatewayRef);
        SET @rid = SCOPE_IDENTITY();
        SET @txn = CONCAT(
            N'TXN',
            RIGHT(
                CONCAT(N'00000000', CONVERT(VARCHAR(20), NEXT VALUE FOR dbo.telo_txn_seq)),
                8
            )
        );
        INSERT INTO dbo.telo_txn (receipt_id, bill_id, txn_id)
        VALUES (@rid, @billId, @txn);

        UPDATE dbo.tbl_billing_patient_detail
        SET amount_paid = ISNULL(amount_paid, 0) + @amount,
            Balance = ISNULL(Balance, amount) - @amount,
            updatedby = CONCAT(N'telo:', ISNULL(@userId, 0)),
            updateddate = GETDATE()
        WHERE id = @billId;

        SELECT @bal = Balance
        FROM dbo.tbl_billing_patient_detail WHERE id = @billId;

        COMMIT;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200)),
               already_recorded = CAST(0 AS BIT), balance = @bal, txn_id = @txn;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200),
               already_recorded = CAST(0 AS BIT), balance = CAST(NULL AS INT),
               txn_id = CAST(NULL AS VARCHAR(24));
    END CATCH
END
