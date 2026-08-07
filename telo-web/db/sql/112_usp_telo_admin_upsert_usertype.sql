/*
 * 112_usp_telo_admin_upsert_usertype.sql
 *
 * Insert or update an LIS user type (tbl_med_usertypes). Soft-deactivation
 * via @isActive=0. Super Admin (id=1) cannot be deactivated. Deactivating a
 * type that still has users is refused unless @force=1.
 *
 * Pass @id=0/NULL to create. Returns { ok, error_code, message, id }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_admin_upsert_usertype
    @id          INT            = NULL,
    @name        NVARCHAR(100),
    @description NVARCHAR(400)  = NULL,
    @isActive    BIT            = 1,
    @force       BIT            = 0,
    @actor       INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @name IS NULL OR LTRIM(RTRIM(@name)) = N''
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Name is required', id = CAST(NULL AS INT);
        RETURN;
    END

    DECLARE @actorTag NVARCHAR(50) = CONCAT(N'telo:', @actor);

    IF @id IS NOT NULL AND @id > 0
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tbl_med_usertypes WHERE id = @id)
        BEGIN
            SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
                   message = N'User type not found', id = CAST(NULL AS INT);
            RETURN;
        END
        IF @id = 1 AND @isActive = 0
        BEGIN
            SELECT ok = CAST(0 AS BIT), error_code = 'FORBIDDEN',
                   message = N'Cannot deactivate LIS Super Admin',
                   id = CAST(NULL AS INT);
            RETURN;
        END
        IF @isActive = 0 AND @force = 0
           AND EXISTS (
               SELECT 1 FROM dbo.tbl_med_user_master WHERE usertypeid = @id
           )
        BEGIN
            SELECT ok = CAST(0 AS BIT), error_code = 'IN_USE',
                   message = N'User type still has users — reassign or force',
                   id = CAST(NULL AS INT);
            RETURN;
        END

        BEGIN TRY
            BEGIN TRAN;
            UPDATE dbo.tbl_med_usertypes
            SET Name = @name,
                Description = @description,
                IsActive = @isActive,
                ModifiedBy = @actorTag,
                ModifiedDate = GETDATE()
            WHERE id = @id;
            COMMIT;
            SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
                   message = CAST(NULL AS NVARCHAR(200)), id = @id;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK;
            SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
                   message = LEFT(ERROR_MESSAGE(), 200),
                   id = CAST(NULL AS INT);
        END CATCH
        RETURN;
    END

    /* create */
    BEGIN TRY
        BEGIN TRAN;
        INSERT INTO dbo.tbl_med_usertypes
            (Name, Description, IsActive, CreatedBy, CreatedDate)
        VALUES
            (@name, @description, @isActive, @actorTag, GETDATE());
        SET @id = SCOPE_IDENTITY();

        /* Ensure an empty security_auth row so action-bit edits have a target. */
        IF NOT EXISTS (
            SELECT 1 FROM dbo.tbl_med_mcc_user_security_auth
            WHERE user_type = @id
        )
            INSERT INTO dbo.tbl_med_mcc_user_security_auth
                (user_type, Auth, EditPatientTests, Result_Entry, Result_Edit,
                 Reject_Sample, Edit_Sales_target, patient_details, Discount, Covid19)
            VALUES
                (@id, 0, 0, 0, 0, 0, 0, 0, 0, 0);

        COMMIT;
        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200)), id = @id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200),
               id = CAST(NULL AS INT);
    END CATCH
END
