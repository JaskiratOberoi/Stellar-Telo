/*
 * 101_usp_telo_admin_set_lis_access.sql
 *
 * Grants or revokes LIS login for a Telo-MANAGED account (one with a row in
 * dbo.telo_account). Sets telo_account.lis_access and re-derives the LIS gate
 * IsActive = (telo_active AND lis_access). The legacy LIS LoginClass reads
 * IsActive, so this is exactly what allows/denies a Telo credential at the LIS.
 *
 * Refuses native LIS users (no telo_account row): their LIS access is theirs
 * to manage in the LIS, not something Telo should silently flip.
 *
 * Same LIS-Super-Admin guard as the other admin procs. Returns
 * { ok, error_code, message }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_admin_set_lis_access
    @userId  INT,
    @enabled BIT,
    @actor   INT
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
               message = N'LIS access is managed by Telo only for Telo-created accounts.';
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
        SET lis_access = @enabled, updated_at = SYSDATETIME()
        WHERE user_id = @userId;

        UPDATE u
        SET u.IsActive = (a.telo_active & a.lis_access),
            u.updatedby = CONCAT(N'telo:', @actor),
            u.updatedDate = GETDATE()
        FROM dbo.tbl_med_user_master u
        JOIN dbo.telo_account a ON a.user_id = u.id
        WHERE u.id = @userId;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200));
    END TRY
    BEGIN CATCH
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200);
    END CATCH
END
