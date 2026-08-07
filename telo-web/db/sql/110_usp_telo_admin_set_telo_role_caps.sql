/*
 * 110_usp_telo_admin_set_telo_role_caps.sql
 *
 * Replace the capability set for one Telo role. @capsJson is a JSON array of
 * capability strings, e.g. '["order:view","bill:view"]'.
 *
 * Guard: super_admin must retain user:manage.
 * After a successful replace, bumps session_version for every user who has
 * that role explicitly assigned (so JWTs refresh).
 *
 * Returns { ok, error_code, message, bumped }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_admin_set_telo_role_caps
    @roleKey   NVARCHAR(40),
    @capsJson  NVARCHAR(MAX),
    @actor     INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @roleKey = LOWER(LTRIM(RTRIM(@roleKey)));
    IF NOT EXISTS (SELECT 1 FROM dbo.telo_role WHERE role_key = @roleKey)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Unknown Telo role', bumped = 0;
        RETURN;
    END

    IF @capsJson IS NULL SET @capsJson = N'[]';

    DECLARE @hasManage BIT = 0;
    IF EXISTS (
        SELECT 1 FROM OPENJSON(@capsJson) WITH (c NVARCHAR(40) '$')
        WHERE c = N'user:manage'
    )
        SET @hasManage = 1;

    IF @roleKey = N'super_admin' AND @hasManage = 0
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'FORBIDDEN',
               message = N'super_admin must keep user:manage', bumped = 0;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        DELETE FROM dbo.telo_role_capability WHERE role_key = @roleKey;

        INSERT INTO dbo.telo_role_capability (role_key, capability)
        SELECT DISTINCT @roleKey, LTRIM(RTRIM(c))
        FROM OPENJSON(@capsJson) WITH (c NVARCHAR(40) '$')
        WHERE c IS NOT NULL AND LTRIM(RTRIM(c)) <> N'';

        UPDATE dbo.telo_role
        SET updated_at = SYSUTCDATETIME(), updated_by = @actor
        WHERE role_key = @roleKey;

        /* Bump sessions for users on this role: explicit override OR
           LIS-default map with no tbl_telo_user_role row. */
        DECLARE @bumped INT = 0;
        ;WITH targets AS (
            SELECT user_id FROM dbo.tbl_telo_user_role WHERE role = @roleKey
            UNION
            SELECT u.id
            FROM dbo.tbl_med_user_master u
            INNER JOIN dbo.telo_lis_usertype_role m
              ON m.lis_usertype_id = u.usertypeid
             AND m.telo_role_key = @roleKey
            WHERE NOT EXISTS (
                SELECT 1 FROM dbo.tbl_telo_user_role tr WHERE tr.user_id = u.id
            )
        )
        MERGE dbo.telo_user_session_version AS tgt
        USING targets AS src
          ON tgt.user_id = src.user_id
        WHEN MATCHED THEN
            UPDATE SET version = tgt.version + 1,
                       updated_at = SYSUTCDATETIME(),
                       updated_by = @actor
        WHEN NOT MATCHED THEN
            INSERT (user_id, version, updated_at, updated_by)
            VALUES (src.user_id, 1, SYSUTCDATETIME(), @actor);
        SET @bumped = @@ROWCOUNT;

        COMMIT;
        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200)), bumped = @bumped;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200), bumped = 0;
    END CATCH
END
