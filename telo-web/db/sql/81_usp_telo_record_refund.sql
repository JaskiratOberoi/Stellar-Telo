/*
 * 81_usp_telo_record_refund.sql
 *
 * Records a REFUND against an existing Telo bill — Telo-internal ONLY.
 * Symmetric counterpart to usp_telo_record_receipt:
 *   - inserts a receipt row marked receive_status='2', pay_mode prefixed
 *     'Refund' so reports can sum refunds separately
 *   - DECREMENTS bill.amount_paid by the refund amount
 *   - INCREMENTS bill.Balance by the refund amount
 *
 * Refund cannot exceed the bill's current amount_paid. Like record_receipt,
 * does NOT post to the LIS client account (tbl_med_mcc_account_*) — Telo's
 * payments and refunds are tracked entirely in Telo's billing tables.
 *
 * Returns { ok, error_code, message, balance INT, txn_id VARCHAR(24) }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_record_refund
    @billId     INT,
    @amount     INT,
    @payMode    VARCHAR(50) = N'Refund',
    @reference  VARCHAR(100) = NULL,  -- cheque#, txn-id, free-text
    @userId     INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @paid INT, @bal INT, @rid INT, @txn VARCHAR(24);

    IF @amount IS NULL OR @amount <= 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Refund amount must be positive',
               balance = CAST(NULL AS INT), txn_id = CAST(NULL AS VARCHAR(24));
        RETURN;
    END

    SELECT @paid = ISNULL(amount_paid, 0), @bal = ISNULL(Balance, 0)
    FROM dbo.tbl_billing_patient_detail WHERE id = @billId;
    IF @@ROWCOUNT = 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Unknown bill', balance = CAST(NULL AS INT),
               txn_id = CAST(NULL AS VARCHAR(24));
        RETURN;
    END
    IF @amount > @paid
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = CONCAT(N'Refund exceeds amount paid (₹', @paid, N')'),
               balance = @bal, txn_id = CAST(NULL AS VARCHAR(24));
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO dbo.tbl_billing_patient_amount_receipt
            (bill_id, recd_date, amount, receivedby, receive_status,
             pay_mode, card_number)
        VALUES
            (@billId, GETDATE(), @amount,
             CONCAT(N'telo:', ISNULL(@userId, 0)), '2',
             LEFT(CONCAT(N'Refund - ', ISNULL(@payMode, N'Cash')), 50),
             @reference);
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
        SET amount_paid = ISNULL(amount_paid, 0) - @amount,
            Balance     = ISNULL(Balance, amount) + @amount,
            updatedby   = CONCAT(N'telo:', ISNULL(@userId, 0)),
            updateddate = GETDATE()
        WHERE id = @billId;

        SELECT @bal = Balance FROM dbo.tbl_billing_patient_detail WHERE id = @billId;

        COMMIT;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200)), balance = @bal, txn_id = @txn;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200),
               balance = CAST(NULL AS INT), txn_id = CAST(NULL AS VARCHAR(24));
    END CATCH
END
