/*
 * 98_usp_telo_admin_set_role.sql
 *
 * UPSERTs a Telo role for a user (UPDATE if a row exists, else INSERT).
 *
 * Defence-in-depth: cannot act on the LIS Super Admin (usertypeid=1) unless
 * the actor is also LIS Super Admin — prevents a runaway Telo admin from
 * downgrading or hijacking the root LIS account.
 *
 * Returns { ok, error_code, message }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_admin_set_role
    @userId   INT,
    @teloRole NVARCHAR(20),
    @actor    INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- NOTE: keep b2c_billing / b2b_billing / client_reporting in this list.
    -- They are live Telo roles (see auth/rbac.ts). Do NOT drop them, and DO
    -- deploy this SP to production whenever the set changes, else the Admin
    -- panel rejects those roles with "Unknown Telo role".
    IF @teloRole NOT IN (N'super_admin', N'admin', N'billing', N'b2c_billing',
                         N'b2b_billing', N'client', N'client_reporting',
                         N'technician', N'viewer')
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Unknown Telo role';
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.tbl_med_user_master WHERE id = @userId)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'User not found';
        RETURN;
    END

    /* Guard: only LIS Super Admin can touch another LIS Super Admin's role,
       AND only an LIS Super Admin actor can promote anyone to Telo super_admin. */
    IF EXISTS (SELECT 1 FROM dbo.tbl_med_user_master
               WHERE id = @userId AND usertypeid = 1)
       AND NOT EXISTS (SELECT 1 FROM dbo.tbl_med_user_master
                       WHERE id = @actor AND usertypeid = 1)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'FORBIDDEN',
               message = N'Only an LIS Super Admin may modify this user';
        RETURN;
    END
    IF @teloRole = N'super_admin'
       AND NOT EXISTS (SELECT 1 FROM dbo.tbl_med_user_master
                       WHERE id = @actor AND usertypeid = 1)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'FORBIDDEN',
               message = N'Only an LIS Super Admin may grant Telo Super Admin';
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        IF EXISTS (SELECT 1 FROM dbo.tbl_telo_user_role WHERE user_id = @userId)
            UPDATE dbo.tbl_telo_user_role
            SET role = @teloRole,
                assigned_by = @actor,
                assigned_at = GETDATE()
            WHERE user_id = @userId;
        ELSE
            INSERT INTO dbo.tbl_telo_user_role (user_id, role, assigned_by)
            VALUES (@userId, @teloRole, @actor);

        COMMIT;
        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200));
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200);
    END CATCH
END
