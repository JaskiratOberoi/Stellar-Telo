/*
 * 85_usp_telo_record_mcc_payment.sql
 *
 * Records a MANUAL client payment (deposit toward Noble) into the shared LIS
 * franchise-wallet ledger — the SAME tables the LIS Admin_General/Mcc_Account.aspx
 * "Save" posts to (tbl_med_mcc_account_master / _detail). Because Telo's Client
 * Accounts read and the LIS screen both derive their figures from these two
 * tables, a payment posted here reconciles identically in BOTH portals.
 *
 * Mirrors the proven write in usp_telo_post_ledger (UPDLOCK on the master row,
 * auto-create it on first use) but as a CREDIT/Payment — the inverse of a debit:
 *   - tbl_med_mcc_account_master.currentbalance += @amount,
 *                                totaldeposited  += @amount
 *   - tbl_med_mcc_account_detail row: credittype = 1 (Payment),
 *       deposittype = @mode, debit_flag = 0, addedby = 'telo:<userId>'
 *       (Telo origin marker; mirrors the LIS username stamp so reads still
 *        attribute and total the row).
 *
 * @mode (deposittype) follows the LIS GetPaymentMode map:
 *   1 DD · 2 Cheque · 3 Cash · 4 NEFT/iNet/Transfer · 5 Online · 6 Other · 7 Reject
 *
 * @depositDate is 'YYYY-MM-DD' (or NULL → now), CAST to DATETIME — same
 * calendar-day handling the date-bounded reads in db/read/mccLedger.ts use.
 *
 * Returns: { ok, error_code, message, new_balance }
 * Not idempotent by design: each call posts one payment row, exactly like the
 * LIS screen's Save. The calling server action throttles + audits.
 *
 * Idempotent to DEPLOY (CREATE OR ALTER). Touches shared LIS tables — treat any
 * deploy as a production migration.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_record_mcc_payment
    @userId      INT,
    @mcc         INT,
    @amount      INT,
    @mode        INT           = 3,     -- deposittype; default Cash
    @depositDate VARCHAR(10)   = NULL,  -- 'YYYY-MM-DD' or NULL → GETDATE()
    @chequeNo    NVARCHAR(50)  = NULL,
    @reason      NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @cur INT, @new INT,
            @dt DATETIME =
                CASE WHEN @depositDate IS NULL OR LTRIM(RTRIM(@depositDate)) = ''
                     THEN GETDATE()
                     ELSE CAST(@depositDate AS DATETIME) END;

    /* ---- validation -------------------------------------------------------- */
    IF NOT EXISTS (SELECT 1 FROM dbo.tbl_med_mcc_unit_master
                   WHERE id = @mcc AND IsActive = 1)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Unknown or inactive client',
               new_balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @amount IS NULL OR @amount <= 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Payment amount must be greater than zero',
               new_balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @mode IS NULL OR @mode < 1 OR @mode > 7
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Invalid payment mode',
               new_balance = CAST(NULL AS INT);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        /* Some clients have no wallet row yet — create it on first use, exactly
           like usp_telo_post_ledger does. */
        IF NOT EXISTS (SELECT 1 FROM dbo.tbl_med_mcc_account_master WHERE mcccode = @mcc)
            INSERT INTO dbo.tbl_med_mcc_account_master (mcccode, totaldeposited, currentbalance)
            VALUES (@mcc, 0, 0);

        SELECT @cur = currentbalance
        FROM dbo.tbl_med_mcc_account_master WITH (UPDLOCK, HOLDLOCK)
        WHERE mcccode = @mcc;

        /* A payment CREDITS the wallet (raises the balance / reduces what the
           client owes) — inverse of the test-charge debit in post_ledger. */
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
            (@mcc, 1, @mode, @dt, @amount,
             LEFT(NULLIF(LTRIM(RTRIM(@chequeNo)), N''), 50),
             LEFT(NULLIF(LTRIM(RTRIM(@reason)),  N''), 200),
             CONCAT(N'telo:', @userId), GETDATE(), 0);

        COMMIT;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200)), new_balance = @new;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200),
               new_balance = CAST(NULL AS INT);
    END CATCH
END
GO
