/*
 * 82_usp_telo_set_bill_discount.sql
 *
 * Sets the ABSOLUTE discount on an existing Telo bill and recomputes Balance.
 * Super-admin-gated at the action layer (actions/billing-admin.actions.ts);
 * this proc additionally refuses non-Telo bills (mirrors the patient editor).
 *
 * Balance is recomputed from the canonical identity Telo's create/receipt/
 * refund procs maintain:
 *     Balance = amount - discount_amount - amount_paid
 *
 * Per product decision, an over-discount IS allowed: if discount + amount_paid
 * exceeds the gross amount the Balance goes negative, signalling a refund is
 * due (the operator then records that refund separately). The only bounds are
 * 0 <= @discount <= amount â€” a discount larger than the gross bill is rejected.
 *
 * Does NOT touch the LIS client account (tbl_med_mcc_account_*) â€” Telo bills
 * are B2C and tracked entirely in Telo's billing tables.
 *
 * Returns { ok, error_code, message, balance INT }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_set_bill_discount
    @billId    INT,
    @discount  INT,
    @userId    INT = NULL,
    -- Origin marker prefix stamped into addedby/updatedby/lastupdatedby, as
    -- '<origin><userId>'. Defaulted to 'telo:' so every existing Telo caller
    -- behaves exactly as before. Stellar Infinity passes 'inf:'.
    @origin NVARCHAR(20) = N'telo:'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @amount INT, @paid INT, @addedby NVARCHAR(100), @bal INT;

    SELECT @amount  = ISNULL(amount, 0),
           @paid    = ISNULL(amount_paid, 0),
           @addedby = addedby
    FROM dbo.tbl_billing_patient_detail
    WHERE id = @billId;

    IF @@ROWCOUNT = 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Bill not found', balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @addedby NOT LIKE 'telo:%' AND @addedby NOT LIKE 'inf:%'
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Only Telo-created bills can be edited here.',
               balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @discount IS NULL OR @discount < 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Discount must be zero or more.',
               balance = CAST(NULL AS INT);
        RETURN;
    END
    IF @discount > @amount
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = CONCAT(N'Discount cannot exceed the bill amount (â‚¹', @amount, N').'),
               balance = CAST(NULL AS INT);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        UPDATE dbo.tbl_billing_patient_detail
        SET discount_amount = @discount,
            Balance         = @amount - @discount - @paid,
            updatedby       = CONCAT(@origin, ISNULL(@userId, 0)),
            updateddate     = GETDATE()
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
