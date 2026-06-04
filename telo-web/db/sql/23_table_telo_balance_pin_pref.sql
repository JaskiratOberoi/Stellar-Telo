/*
 * 23_table_telo_balance_pin_pref.sql — per-user "unpin" exceptions for the
 * negative-balance pinning feature on the Accounts (/balances/[mcc]) screen.
 *
 * Negative-balance bills are PINNED to the top of the accounts table BY DEFAULT
 * to draw attention (a negative balance usually means an overpayment / refund
 * due). A user may "unpin" a specific bill so it drops back into normal date
 * order — but ONLY in their own view. The preference is keyed by Telo user_id,
 * so colleagues who share the same client login still see the bill pinned.
 *
 * Storage is EXCEPTION-based: a row here means "this user has unpinned this
 * bill". No row == pinned (the default). Re-pinning deletes the row, so new
 * negative bills appear pinned automatically with zero backfill.
 *
 * Telo-owned sidecar: references tbl_billing_patient_detail.id and
 * tbl_med_user_master.id BY VALUE (no FK) so no LIS table is touched or coupled.
 * Idempotent: only creates the table when absent.
 */
IF OBJECT_ID('dbo.telo_balance_pin_pref', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.telo_balance_pin_pref (
        user_id    INT       NOT NULL,
        bill_id    INT       NOT NULL,
        created_at DATETIME2 NOT NULL
                   CONSTRAINT DF_telo_balance_pin_pref_created DEFAULT SYSDATETIME(),
        CONSTRAINT PK_telo_balance_pin_pref PRIMARY KEY (user_id, bill_id)
    );
    PRINT 'Created dbo.telo_balance_pin_pref.';
END
ELSE
BEGIN
    PRINT 'dbo.telo_balance_pin_pref already present.';
END
