/*
 * 70_usp_telo_post_ledger.sql
 *
 * DEPRECATED / NOT CALLED. Telo no longer debits the franchise wallet at order
 * registration â€” the LIS does it when the order is moved Accessioning â†’
 * Worksheet via the Accession "Register" button (CheckTransCash). Posting it
 * from Telo too would double-debit. Kept deployed for reference / rollback.
 *
 * Posts ONE net debit for a bill to the MCC account ledger, faithful to the
 * legacy LIS flow (MccAccountClass + sp_mcc_test_account_101):
 *   - sp_mcc_test_account_101 logs a tbl_med_mcc_test_transactions row
 *   - tbl_med_mcc_account_master.currentbalance is decremented
 *   - a tbl_med_mcc_account_detail debit row is recorded
 * Called INSIDE the create_order transaction. account_master row created on
 * first use (some MCCs have none yet).
 *
 * Pure OUTPUT params â€” emits NO result set so it composes cleanly inside
 * usp_telo_create_order's nested EXEC.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_post_ledger
    @userId          INT,
    @mcc             INT,
    @vailid          NVARCHAR(50),
    @patientId       INT,
    @amount          INT,
    @note            NVARCHAR(100) = N'Telo order',
    @closing_balance INT          OUTPUT,
    @ok              BIT          OUTPUT,
    @error_code      VARCHAR(20)  OUTPUT,
    -- Origin marker prefix stamped into addedby/updatedby/lastupdatedby, as
    -- '<origin><userId>'. Defaulted to 'telo:' so every existing Telo caller
    -- behaves exactly as before. Stellar Infinity passes 'inf:'.
    @origin NVARCHAR(20) = N'telo:'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @ok = 0; SET @error_code = NULL; SET @closing_balance = NULL;

    DECLARE @cur INT;

    IF NOT EXISTS (SELECT 1 FROM dbo.tbl_med_mcc_account_master WHERE mcccode = @mcc)
        INSERT INTO dbo.tbl_med_mcc_account_master (mcccode, totaldeposited, currentbalance)
        VALUES (@mcc, 0, 0);

    SELECT @cur = currentbalance
    FROM dbo.tbl_med_mcc_account_master WITH (UPDLOCK, HOLDLOCK)
    WHERE mcccode = @mcc;

    SET @closing_balance = @cur - @amount;

    EXEC dbo.sp_mcc_test_account_101
        @USERID = @userId, @MCCID = @mcc, @TDATE = NULL,
        @CBALANCE = @cur, @TESTCHARGES = @amount,
        @CLOSINGBALANCE = @closing_balance,
        @tname = @note, @vailid = @vailid, @patientid = @patientId,
        @SUBFRANCHISE = NULL;

    UPDATE dbo.tbl_med_mcc_account_master
    SET currentbalance = @closing_balance,
        lastupdatedby = CONCAT(@origin, @userId),
        lastupdateddate = GETDATE()
    WHERE mcccode = @mcc;

    INSERT INTO dbo.tbl_med_mcc_account_detail
        (mcccode, credittype, depositedate, amount, Reason,
         addedby, addeddate, debit_flag)
    VALUES
        (@mcc, 3, GETDATE(), @amount,
         CONCAT(@note, N' (vailid ', @vailid, N')'),
         CONCAT(@origin, @userId), GETDATE(), 1);

    SET @ok = 1;
END
