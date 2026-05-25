/*
 * 99_usp_telo_admin_reset_password.sql
 *
 * Sets a new plaintext password on tbl_med_user_master. Same guard as
 * set_role: only an LIS Super Admin actor can reset an LIS Super Admin's
 * password.
 *
 * The action layer never logs the password value to the audit stream.
 * Returns { ok, error_code, message }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_admin_reset_password
    @userId      INT,
    @newPassword NVARCHAR(50),
    @actor       INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @newPassword IS NULL OR LTRIM(RTRIM(@newPassword)) = N''
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Password is required';
        RETURN;
    END
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
               message = N'Only an LIS Super Admin may reset this user';
        RETURN;
    END

    BEGIN TRY
        UPDATE dbo.tbl_med_user_master
        SET password = @newPassword,
            updatedby = CONCAT(N'telo:', @actor),
            updatedDate = GETDATE()
        WHERE id = @userId;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200));
    END TRY
    BEGIN CATCH
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200);
    END CATCH
END
