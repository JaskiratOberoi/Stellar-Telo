/*
 * 109_usp_telo_admin_upsert_telo_role.sql
 *
 * Insert or update a Telo role (label / description / active). New roles
 * get is_builtin=0. Built-in role keys cannot be deactivated while users
 * still hold that role (explicit tbl_telo_user_role rows).
 *
 * Returns { ok, error_code, message }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_admin_upsert_telo_role
    @roleKey      NVARCHAR(40),
    @label        NVARCHAR(100),
    @description  NVARCHAR(400) = NULL,
    @isActive     BIT           = 1,
    @actor        INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @roleKey IS NULL OR LTRIM(RTRIM(@roleKey)) = N''
       OR @label IS NULL OR LTRIM(RTRIM(@label)) = N''
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Role key and label are required';
        RETURN;
    END

    SET @roleKey = LOWER(LTRIM(RTRIM(@roleKey)));
    IF @roleKey NOT LIKE N'[a-z]%' OR @roleKey LIKE N'%[^a-z0-9_]%'
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Role key must be lowercase letters, digits, underscore';
        RETURN;
    END

    IF @isActive = 0 AND @roleKey = N'super_admin'
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'FORBIDDEN',
               message = N'Cannot deactivate the super_admin role';
        RETURN;
    END

    IF @isActive = 0
       AND EXISTS (SELECT 1 FROM dbo.tbl_telo_user_role WHERE role = @roleKey)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'IN_USE',
               message = N'Role is assigned to users — reassign them first';
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        IF EXISTS (SELECT 1 FROM dbo.telo_role WHERE role_key = @roleKey)
            UPDATE dbo.telo_role
            SET label = @label,
                description = @description,
                is_active = @isActive,
                updated_at = SYSUTCDATETIME(),
                updated_by = @actor
            WHERE role_key = @roleKey;
        ELSE
            INSERT INTO dbo.telo_role
                (role_key, label, description, is_active, is_builtin, updated_by, updated_at)
            VALUES
                (@roleKey, @label, @description, @isActive, 0, @actor, SYSUTCDATETIME());

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
