/*
 * 100_usp_telo_admin_set_active.sql
 *
 * Enables/disables an account's TELO login. Same Super-Admin guard as
 * set_role / reset_password.
 *
 * Telo-managed accounts (a row in dbo.telo_account): toggles telo_active and
 * re-derives the LIS gate IsActive = (telo_active AND lis_access). Disabling
 * therefore also revokes LIS access; re-enabling restores whatever lis_access
 * intent was previously set.
 *
 * Native LIS users (no telo_account row): legacy behaviour — toggles IsActive
 * directly.
 *
 * Returns { ok, error_code, message }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_admin_set_active
    @userId INT,
    @active BIT,
    @actor  INT
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
        IF EXISTS (SELECT 1 FROM dbo.telo_account WHERE user_id = @userId)
        BEGIN
            UPDATE dbo.telo_account
            SET telo_active = @active, updated_at = SYSDATETIME()
            WHERE user_id = @userId;

            UPDATE u
            SET u.IsActive = (a.telo_active & a.lis_access),
                u.updatedby = CONCAT(N'telo:', @actor),
                u.updatedDate = GETDATE()
            FROM dbo.tbl_med_user_master u
            JOIN dbo.telo_account a ON a.user_id = u.id
            WHERE u.id = @userId;
        END
        ELSE
        BEGIN
            UPDATE dbo.tbl_med_user_master
            SET IsActive = @active,
                updatedby = CONCAT(N'telo:', @actor),
                updatedDate = GETDATE()
            WHERE id = @userId;
        END

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200));
    END TRY
    BEGIN CATCH
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200);
    END CATCH
END
