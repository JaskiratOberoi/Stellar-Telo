/*
 * 111_usp_telo_admin_set_lis_usertype_role.sql
 *
 * Upsert the default Telo role for an LIS usertype (used when the user has
 * no tbl_telo_user_role row).
 *
 * Returns { ok, error_code, message }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_admin_set_lis_usertype_role
    @lisUsertypeId INT,
    @teloRoleKey   NVARCHAR(40),
    @actor         INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @teloRoleKey = LOWER(LTRIM(RTRIM(@teloRoleKey)));

    IF NOT EXISTS (SELECT 1 FROM dbo.tbl_med_usertypes WHERE id = @lisUsertypeId)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Unknown LIS user type';
        RETURN;
    END
    IF NOT EXISTS (
        SELECT 1 FROM dbo.telo_role
        WHERE role_key = @teloRoleKey AND is_active = 1
    )
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Unknown or inactive Telo role';
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        IF EXISTS (
            SELECT 1 FROM dbo.telo_lis_usertype_role
            WHERE lis_usertype_id = @lisUsertypeId
        )
            UPDATE dbo.telo_lis_usertype_role
            SET telo_role_key = @teloRoleKey,
                updated_at = SYSUTCDATETIME(),
                updated_by = @actor
            WHERE lis_usertype_id = @lisUsertypeId;
        ELSE
            INSERT INTO dbo.telo_lis_usertype_role
                (lis_usertype_id, telo_role_key, updated_by)
            VALUES (@lisUsertypeId, @teloRoleKey, @actor);

        /* Users on this LIS type with no explicit Telo role get the new default. */
        ;WITH targets AS (
            SELECT u.id AS user_id
            FROM dbo.tbl_med_user_master u
            WHERE u.usertypeid = @lisUsertypeId
              AND NOT EXISTS (
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
