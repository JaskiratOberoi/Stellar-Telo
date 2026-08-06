/*
 * 80_usp_telo_record_receipt.sql
 *
 * Records a payment against an EXISTING bill â€” Telo-internal ONLY. Atomic:
 * inserts a receipt row, bumps amount_paid, recomputes Balance.
 *
 * It deliberately does NOT post to the LIS client account
 * (tbl_med_mcc_account_*). Telo is the B2C portal â€” patient payments are
 * tracked entirely within Telo's own billing tables. The LIS is the B2B
 * portal: its client-account ledger is settled manually when the franchise
 * clears its balance. Franchise test-charge debits remain the LIS's job
 * (Accession "Register" -> CheckTransCash).
 *
 * Idempotent on @gatewayRef: a repeated webhook for the same payment id is a
 * no-op (returns ok with already_recorded=1) so payment retries are safe.
 *
 * Returns: { ok, error_code, message, already_recorded BIT, balance INT, txn_id VARCHAR(24) }
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_record_receipt
    @billId      INT,
    @amount      INT,
    @payMode     VARCHAR(50)  = N'Online',
    @gatewayRef  VARCHAR(100) = NULL,
    @userId      INT          = NULL,
    -- Origin marker prefix stamped into addedby/updatedby/lastupdatedby, as
    -- '<origin><userId>'. Defaulted to 'telo:' so every existing Telo caller
    -- behaves exactly as before. Stellar Infinity passes 'inf:'.
    @origin NVARCHAR(20) = N'telo:'
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

    -- Idempotency: same gateway payment id already captured.
    IF @gatewayRef IS NOT NULL AND EXISTS (
        SELECT 1 FROM dbo.tbl_billing_patient_amount_receipt
        WHERE bill_id = @billId AND card_number = @gatewayRef)
    BEGIN
        SELECT @bal = Balance FROM dbo.tbl_billing_patient_detail WHERE id = @billId;
        SELECT @txn = t.txn_id
        FROM dbo.telo_txn t
        JOIN dbo.tbl_billing_patient_amount_receipt r ON r.id = t.receipt_id
        WHERE r.bill_id = @billId AND r.card_number = @gatewayRef;
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
             CONCAT(@origin, ISNULL(@userId, 0)), '1',
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
            updatedby = CONCAT(@origin, ISNULL(@userId, 0)),
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
