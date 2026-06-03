/*
 * 16_alter_telo_account_add_mrp_only.sql
 *
 * Per-account "MRP only" flag on the Telo sidecar dbo.telo_account. When set,
 * the user only sees the classic New-Order tab (MRP pricing) and the new
 * "B2B Orders" tab is hidden for them. Default 0 ⇒ a user (and every native
 * LIS user with no telo_account row) sees the B2B tab.
 *
 * Purely additive: a NULLABLE-safe BIT NOT NULL DEFAULT 0. No existing column
 * or data is touched.
 *
 * One-time, set-only MDCARE seed: MEDICARE SUPER SPECIALITY HOSPITAL (MCC id
 * 5797, MCCUnitCode 'MDCARE') must NOT get the B2B feature. Its Telo logins are
 * the medicare_* accounts (the only telo_account rows today; 5 of 6 carry a
 * sales-mcc mapping to MCC 5797, and all share the 'medicare' username prefix).
 * The seed only flips rows currently 0 → 1; it never clears a flag, so re-runs
 * are idempotent and an admin can adjust any account afterward via the
 * /admin/users toggle. A user the seed misses simply sees the B2B tab (a
 * non-destructive failure mode).
 */
SET NOCOUNT ON;

IF COL_LENGTH('dbo.telo_account', 'mrp_only') IS NULL
BEGIN
    ALTER TABLE dbo.telo_account
        ADD mrp_only BIT NOT NULL
            CONSTRAINT DF_telo_account_mrp_only DEFAULT 0;
    PRINT 'Added dbo.telo_account.mrp_only (default 0).';
END
ELSE
    PRINT 'dbo.telo_account.mrp_only already present.';
GO

/* MDCARE seed — set-only, idempotent. */
UPDATE ta
SET ta.mrp_only = 1, ta.updated_at = SYSDATETIME()
FROM dbo.telo_account ta
WHERE ta.mrp_only = 0
  AND EXISTS (
        SELECT 1
        FROM dbo.tbl_med_user_master u
        WHERE u.id = ta.user_id
          AND (
                u.Username LIKE 'medicare%'
             OR u.PCC_Id = 5797
             OR u.sub_pcc_id = 5797
             OR EXISTS (
                    SELECT 1 FROM dbo.tbl_med_user_sales_mcc_mapping m
                    WHERE m.user_id = u.id AND m.mcc_code = 5797
                )
          )
  );
PRINT CONCAT('MDCARE mrp_only seed: ', @@ROWCOUNT, ' account(s) set.');
GO
