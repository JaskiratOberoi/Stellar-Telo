/*
 * 86_usp_telo_record_mcc_online_payment.sql
 *
 * The CALLBACK side of the CCAvenue client-payment flow. Given a gateway
 * `order_id` (created PENDING by app/api/ccavenue/initiate) and the decrypted
 * response fields, this:
 *
 *   1. Locks the matching dbo.telo_payment_order row (the trust anchor — it
 *      carries the mcc / user_id / amount we authorised; the callback's own
 *      values are NEVER trusted for those).
 *   2. Is IDEMPOTENT: if the order was already posted (posted=1), it returns
 *      already_recorded=1 with the live balance and changes nothing — a
 *      replayed/duplicate callback (CCAvenue can POST the redirect more than
 *      once, and the user may refresh) cannot double-credit the wallet.
 *   3. On a 'Success' status, posts exactly the SAME wallet credit the manual
 *      path (usp_telo_record_mcc_payment) does — credittype=1, deposittype=5
 *      (Online), addedby='telo:<userId>' — so the balance reconciles in Telo
 *      AND the LIS Mcc_Account screen, and Telo's reads tag it isOnline.
 *      chequeorddnummber = order_id, Reason = bank_ref (mirrors the LIS
 *      CCAvenue auto-post: order id in the cheque/txn column, bank ref in
 *      Reason).
 *   4. On any non-Success status, records the outcome on the order row only
 *      (no wallet write) and returns recorded=0.
 *
 * The amount credited is the order's authorised @amount (what we told the
 * gateway to collect). The gateway's reported @paidAmount is stored on the
 * order row for audit/reconciliation; a mismatch is surfaced via error_code
 * 'AMOUNT_MISMATCH' but the payment is STILL posted at the authorised amount
 * (money moved — never silently drop a successful collection; the mismatch is
 * a flag for a human to reconcile).
 *
 * Returns one row:
 *   { ok, error_code, message, recorded, already_recorded, new_balance }
 *     ok               1 when the callback was handled (even a failed payment)
 *     recorded         1 when a wallet credit was newly posted this call
 *     already_recorded 1 when the order had already been posted
 *     new_balance      live wallet balance after handling (NULL if not posted)
 *
 * Idempotent to DEPLOY (CREATE OR ALTER). Touches the shared LIS wallet on the
 * Success path — treat any deploy as a production migration.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_record_mcc_online_payment
    @orderId     VARCHAR(30),
    @status      VARCHAR(20),          -- CCAvenue order_status (Success/Aborted/Failure/Invalid/…)
    @paidAmount  INT           = NULL, -- gateway-reported charged amount (audit)
    @trackingId  VARCHAR(40)   = NULL,
    @bankRef     VARCHAR(60)   = NULL,
    @paymentMode VARCHAR(40)   = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @mcc INT, @userId INT, @amount INT, @posted BIT,
            @cur INT, @new INT, @detailId INT,
            @isSuccess BIT = CASE WHEN UPPER(LTRIM(RTRIM(@status))) = 'SUCCESS'
                                  THEN 1 ELSE 0 END,
            @mismatch BIT = 0;

    BEGIN TRY
        BEGIN TRAN;

        SELECT @mcc = mcc, @userId = user_id, @amount = amount, @posted = posted
        FROM dbo.telo_payment_order WITH (UPDLOCK, HOLDLOCK)
        WHERE order_id = @orderId;

        IF @mcc IS NULL
        BEGIN
            COMMIT;
            SELECT ok = CAST(0 AS BIT), error_code = 'UNKNOWN_ORDER',
                   message = N'No matching payment order',
                   recorded = CAST(0 AS BIT), already_recorded = CAST(0 AS BIT),
                   new_balance = CAST(NULL AS INT);
            RETURN;
        END

        /* Idempotency: already posted → no-op, return the live balance. */
        IF @posted = 1
        BEGIN
            SELECT @new = currentbalance FROM dbo.tbl_med_mcc_account_master
             WHERE mcccode = @mcc;
            UPDATE dbo.telo_payment_order
               SET tracking_id  = COALESCE(tracking_id, @trackingId),
                   bank_ref     = COALESCE(bank_ref, @bankRef),
                   payment_mode = COALESCE(payment_mode, @paymentMode),
                   updated_at   = SYSDATETIME()
             WHERE order_id = @orderId;
            COMMIT;
            SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
                   message = N'Already recorded',
                   recorded = CAST(0 AS BIT), already_recorded = CAST(1 AS BIT),
                   new_balance = @new;
            RETURN;
        END

        /* Non-success: stamp the outcome on the order row, no wallet write. */
        IF @isSuccess = 0
        BEGIN
            UPDATE dbo.telo_payment_order
               SET status = LEFT(UPPER(LTRIM(RTRIM(@status))), 12),
                   tracking_id = @trackingId, bank_ref = @bankRef,
                   payment_mode = @paymentMode, paid_amount = @paidAmount,
                   updated_at = SYSDATETIME()
             WHERE order_id = @orderId;
            COMMIT;
            SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
                   message = N'Payment not successful',
                   recorded = CAST(0 AS BIT), already_recorded = CAST(0 AS BIT),
                   new_balance = CAST(NULL AS INT);
            RETURN;
        END

        /* ---- Success: post the wallet credit (mirror record_mcc_payment) --- */
        IF @paidAmount IS NOT NULL AND @paidAmount <> @amount SET @mismatch = 1;

        IF NOT EXISTS (SELECT 1 FROM dbo.tbl_med_mcc_account_master WHERE mcccode = @mcc)
            INSERT INTO dbo.tbl_med_mcc_account_master (mcccode, totaldeposited, currentbalance)
            VALUES (@mcc, 0, 0);

        SELECT @cur = currentbalance
        FROM dbo.tbl_med_mcc_account_master WITH (UPDLOCK, HOLDLOCK)
        WHERE mcccode = @mcc;

        SET @new = ISNULL(@cur, 0) + @amount;

        UPDATE dbo.tbl_med_mcc_account_master
           SET currentbalance  = @new,
               totaldeposited  = ISNULL(totaldeposited, 0) + @amount,
               lastupdatedby   = CONCAT(N'telo:', @userId),
               lastupdateddate = GETDATE()
         WHERE mcccode = @mcc;

        INSERT INTO dbo.tbl_med_mcc_account_detail
            (mcccode, credittype, deposittype, depositedate, amount,
             chequeorddnummber, Reason, addedby, addeddate, debit_flag)
        VALUES
            (@mcc, 1, 5, GETDATE(), @amount,
             LEFT(@orderId, 50),
             LEFT(NULLIF(LTRIM(RTRIM(@bankRef)), N''), 200),
             CONCAT(N'telo:', @userId), GETDATE(), 0);

        SET @detailId = CAST(SCOPE_IDENTITY() AS INT);

        UPDATE dbo.telo_payment_order
           SET status = 'SUCCESS', posted = 1, detail_id = @detailId,
               tracking_id = @trackingId, bank_ref = @bankRef,
               payment_mode = @paymentMode, paid_amount = @paidAmount,
               updated_at = SYSDATETIME()
         WHERE order_id = @orderId;

        COMMIT;

        SELECT ok = CAST(1 AS BIT),
               error_code = CASE WHEN @mismatch = 1 THEN 'AMOUNT_MISMATCH'
                                 ELSE CAST(NULL AS VARCHAR(20)) END,
               message = CASE WHEN @mismatch = 1
                              THEN N'Posted at authorised amount; gateway amount differs — please reconcile'
                              ELSE CAST(NULL AS NVARCHAR(200)) END,
               recorded = CAST(1 AS BIT), already_recorded = CAST(0 AS BIT),
               new_balance = @new;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200),
               recorded = CAST(0 AS BIT), already_recorded = CAST(0 AS BIT),
               new_balance = CAST(NULL AS INT);
    END CATCH
END
GO
