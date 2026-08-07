/*
 * 113_usp_telo_admin_set_usertype_security.sql
 *
 * Replace LIS Security Master grants for one usertype + upsert action bits.
 *
 * @menuIdsJson — JSON array of menu ids, e.g. '[1,2,28]'. Row presence in
 * tbl_med_security_master is the grant (read/write/delete bits unused by LIS).
 *
 * @authBitsJson — JSON object with the 9 action-bit flags, e.g.
 *   {"Auth":true,"Discount":false,...}
 *
 * Guard: Super Admin (usertype=1) cannot lose the Security (13) or User
 * Levels (19) menus.
 *
 * Returns { ok, error_code, message }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_admin_set_usertype_security
    @usertype     INT,
    @menuIdsJson  NVARCHAR(MAX),
    @authBitsJson NVARCHAR(MAX),
    @actor        INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.tbl_med_usertypes WHERE id = @usertype)
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Unknown user type';
        RETURN;
    END

    IF @menuIdsJson IS NULL SET @menuIdsJson = N'[]';
    IF @authBitsJson IS NULL SET @authBitsJson = N'{}';

    /* Super Admin must keep Security + User Levels menus. */
    IF @usertype = 1
       AND (
            NOT EXISTS (
                SELECT 1 FROM OPENJSON(@menuIdsJson) WITH (id INT '$') WHERE id = 13
            )
         OR NOT EXISTS (
                SELECT 1 FROM OPENJSON(@menuIdsJson) WITH (id INT '$') WHERE id = 19
            )
       )
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'FORBIDDEN',
               message = N'Super Admin must keep Security and User Levels menus';
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        DELETE FROM dbo.tbl_med_security_master WHERE usertype = @usertype;

        INSERT INTO dbo.tbl_med_security_master
            (usertype, menuid, _read, write, _delete, menu_titleid)
        SELECT DISTINCT
            @usertype,
            j.id,
            NULL, NULL, NULL,
            m.menu_id
        FROM OPENJSON(@menuIdsJson) WITH (id INT '$') j
        INNER JOIN dbo.tbl_med_menu_master m ON m.id = j.id
        WHERE j.id IS NOT NULL;

        DECLARE
            @Auth BIT = 0, @EditPatientTests BIT = 0, @Result_Entry BIT = 0,
            @Result_Edit BIT = 0, @Reject_Sample BIT = 0,
            @Edit_Sales_target BIT = 0, @patient_details BIT = 0,
            @Discount BIT = 0, @Covid19 BIT = 0;

        /* JSON booleans arrive as the strings 'true'/'false' via JSON_VALUE. */
        SET @Auth = CASE WHEN LOWER(ISNULL(JSON_VALUE(@authBitsJson, '$.Auth'), 'false')) IN (N'true', N'1') THEN 1 ELSE 0 END;
        SET @EditPatientTests = CASE WHEN LOWER(ISNULL(JSON_VALUE(@authBitsJson, '$.EditPatientTests'), 'false')) IN (N'true', N'1') THEN 1 ELSE 0 END;
        SET @Result_Entry = CASE WHEN LOWER(ISNULL(JSON_VALUE(@authBitsJson, '$.Result_Entry'), 'false')) IN (N'true', N'1') THEN 1 ELSE 0 END;
        SET @Result_Edit = CASE WHEN LOWER(ISNULL(JSON_VALUE(@authBitsJson, '$.Result_Edit'), 'false')) IN (N'true', N'1') THEN 1 ELSE 0 END;
        SET @Reject_Sample = CASE WHEN LOWER(ISNULL(JSON_VALUE(@authBitsJson, '$.Reject_Sample'), 'false')) IN (N'true', N'1') THEN 1 ELSE 0 END;
        SET @Edit_Sales_target = CASE WHEN LOWER(ISNULL(JSON_VALUE(@authBitsJson, '$.Edit_Sales_target'), 'false')) IN (N'true', N'1') THEN 1 ELSE 0 END;
        SET @patient_details = CASE WHEN LOWER(ISNULL(JSON_VALUE(@authBitsJson, '$.patient_details'), 'false')) IN (N'true', N'1') THEN 1 ELSE 0 END;
        SET @Discount = CASE WHEN LOWER(ISNULL(JSON_VALUE(@authBitsJson, '$.Discount'), 'false')) IN (N'true', N'1') THEN 1 ELSE 0 END;
        SET @Covid19 = CASE WHEN LOWER(ISNULL(JSON_VALUE(@authBitsJson, '$.Covid19'), 'false')) IN (N'true', N'1') THEN 1 ELSE 0 END;

        IF EXISTS (
            SELECT 1 FROM dbo.tbl_med_mcc_user_security_auth
            WHERE user_type = @usertype
        )
            UPDATE dbo.tbl_med_mcc_user_security_auth
            SET Auth = @Auth,
                EditPatientTests = @EditPatientTests,
                Result_Entry = @Result_Entry,
                Result_Edit = @Result_Edit,
                Reject_Sample = @Reject_Sample,
                Edit_Sales_target = @Edit_Sales_target,
                patient_details = @patient_details,
                Discount = @Discount,
                Covid19 = @Covid19
            WHERE user_type = @usertype;
        ELSE
            INSERT INTO dbo.tbl_med_mcc_user_security_auth
                (user_type, Auth, EditPatientTests, Result_Entry, Result_Edit,
                 Reject_Sample, Edit_Sales_target, patient_details, Discount, Covid19)
            VALUES
                (@usertype, @Auth, @EditPatientTests, @Result_Entry, @Result_Edit,
                 @Reject_Sample, @Edit_Sales_target, @patient_details, @Discount, @Covid19);

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
