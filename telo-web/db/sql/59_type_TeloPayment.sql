/*
 * 59_type_TeloPayment.sql — TVP for split payments at order registration.
 *
 * Passed to usp_telo_create_order. One row per payment line the patient made
 * at registration (e.g. ₹500 Cash + ₹500 UPI). The SP writes ONE
 * tbl_billing_patient_amount_receipt row per line and mints one telo_txn id
 * each; the bill header's single payment_type column shows the method when one
 * was used, or 'Mixed' when the patient split across methods.
 *
 *   seq    — 1-based ordering within the order (PK)
 *   method — Cash / UPI / Card / Cheque / Online (free text, mirrors the
 *            legacy pay_mode column)
 *   amount — rupees for THIS line (> 0; the SP ignores non-positive rows)
 *   ref    — operator-entered reference for a non-cash line (UPI ref, cheque
 *            no., card auth code); NULL for Cash. Stored on the receipt's
 *            card_number column.
 *
 * Numbered 59 so the type exists before its only consumer (60_usp_telo_
 * create_order.sql) in a full lexical deploy.
 */
IF TYPE_ID(N'dbo.TeloPayment') IS NULL
BEGIN
    CREATE TYPE dbo.TeloPayment AS TABLE
    (
        seq    INT          NOT NULL,
        method VARCHAR(50)  NOT NULL,
        amount INT          NOT NULL,
        ref    NVARCHAR(50) NULL,
        PRIMARY KEY (seq)
    );
END
