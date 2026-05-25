/*
 * 97_usp_telo_admin_create_user.sql
 *
 * Onboards a new Telo user. Atomic: writes one row in tbl_med_user_master
 * (LIS user, plaintext password) AND one in tbl_telo_user_role. The LIS
 * usertypeid is required because LIS screens key on it; the Telo role is the
 * only thing that drives access to Telo's own tabs/actions.
 *
 * Username uniqueness is enforced here (the LIS table has no unique index).
 * Returns { ok, error_code, message, user_id }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_admin_create_user
    @username      NVARCHAR(50),
    @password      NVARCHAR(50),
    @firstName     NVARCHAR(100),
    @lastName      NVARCHAR(100) = NULL,
    @email         NVARCHAR(100) = NULL,
    @lisUsertypeId INT,
    @teloRole      NVARCHAR(20),
    @actor         INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @clean NVARCHAR(50) = LTRIM(RTRIM(@username));
    IF @clean IS NULL OR @clean = N''
        OR @password IS NULL OR LTRIM(RTRIM(@password)) = N''
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Username and password are required',
               user_id = CAST(NULL AS INT);
        RETURN;
    END
    IF @teloRole NOT IN (N'super_admin', N'admin', N'billing',
                         N'technician', N'viewer')
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Unknown Telo role',
               user_id = CAST(NULL AS INT);
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.tbl_med_usertypes
                   WHERE id = @lisUsertypeId AND IsActive = 1)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Unknown or inactive LIS user type',
               user_id = CAST(NULL AS INT);
        RETURN;
    END
    IF EXISTS (SELECT 1 FROM dbo.tbl_med_user_master WHERE Username = @clean)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'CONFLICT',
               message = N'Username already exists',
               user_id = CAST(NULL AS INT);
        RETURN;
    END

    /* Guard: only an LIS Super Admin actor may mint another Super Admin user. */
    IF @teloRole = N'super_admin'
       AND NOT EXISTS (SELECT 1 FROM dbo.tbl_med_user_master
                       WHERE id = @actor AND usertypeid = 1)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'FORBIDDEN',
               message = N'Only an LIS Super Admin may create a Telo Super Admin',
               user_id = CAST(NULL AS INT);
        RETURN;
    END

    DECLARE @newId INT;
    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO dbo.tbl_med_user_master
            (Username, password, firstname, lastname, Email,
             usertypeid, IsActive, createdby, createddate)
        VALUES
            (@clean, @password,
             LEFT(ISNULL(@firstName, N''), 100),
             LEFT(ISNULL(@lastName, N''), 100),
             LEFT(ISNULL(@email, N''), 100),
             @lisUsertypeId, 1,
             CONCAT(N'telo:', @actor), GETDATE());
        SET @newId = SCOPE_IDENTITY();

        INSERT INTO dbo.tbl_telo_user_role (user_id, role, assigned_by)
        VALUES (@newId, @teloRole, @actor);

        COMMIT;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200)), user_id = @newId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200),
               user_id = CAST(NULL AS INT);
    END CATCH
END
