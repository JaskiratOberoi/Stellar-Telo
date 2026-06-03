/*
 * 22_usp_telo_admin_set_prepared_by.sql
 *
 * Sets the per-account "Prepared by" override (dbo.telo_account.prepared_by)
 * for a Telo-MANAGED account. When non-empty, this string prints as the bill's
 * "Prepared By" for every order the account registers (overriding the
 * auto-filled registering-user name and the per-MCC invoice config). An empty/
 * whitespace value clears the override (stored as NULL ⇒ fall back to default).
 *
 * Refuses native LIS users (no telo_account row) — Telo only manages overrides
 * for accounts it owns. Same LIS-Super-Admin guard as the other admin procs.
 * Returns { ok, error_code, message }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_admin_set_prepared_by
    @userId     INT,
    @preparedBy NVARCHAR(120),
    @actor      INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.tbl_med_user_master WHERE id = @userId)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'User not found';
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.telo_account WHERE user_id = @userId)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Prepared-by override is managed by Telo only for Telo-created accounts.';
        RETURN;
    END
    IF EXISTS (SELECT 1 FROM dbo.tbl_med_user_master
               WHERE id = @userId AND usertypeid = 1)
       AND NOT EXISTS (SELECT 1 FROM dbo.tbl_med_user_master
                       WHERE id = @actor AND usertypeid = 1)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'FORBIDDEN',
               message = N'Only an LIS Super Admin may modify this user';
        RETURN;
    END

    BEGIN TRY
        UPDATE dbo.telo_account
        SET prepared_by = NULLIF(LTRIM(RTRIM(@preparedBy)), N''),
            updated_at  = SYSDATETIME()
        WHERE user_id = @userId;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200));
    END TRY
    BEGIN CATCH
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200);
    END CATCH
END
GO
