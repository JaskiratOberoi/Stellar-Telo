/*
 * 20_usp_telo_authenticate.sql
 *
 * Read-only credential check. Mirrors the legacy LIS LoginClass.cs exactly:
 *   tbl_med_user_masters.Where(c => c.Username == u && c.password == p && c.IsActive == true)
 *
 * Passwords in Noble are PLAINTEXT (stakeholder-accepted risk). The comparison
 * is via a typed SQL parameter, so this is NOT a SQL-injection vector.
 *
 * Returns exactly one row on success (user identity + role + security bits),
 * zero rows on failure. MCC scope is resolved separately by the app and cached
 * (10k+ mapping rows — not bundled into the auth round-trip).
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_authenticate
    @Username NVARCHAR(50),
    @Password NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        u.id                AS user_id,
        u.Username          AS username,
        u.firstname         AS first_name,
        u.lastname          AS last_name,
        u.Email             AS email,
        u.usertypeid        AS usertype_id,
        ut.Name             AS usertype_name,
        u.PCC_Id            AS pcc_id,
        u.sub_pcc_id        AS sub_pcc_id,
        u.Business_Unit_id  AS business_unit_id,
        CAST(ISNULL(sa.Auth, 0)             AS BIT) AS cap_auth,
        CAST(ISNULL(sa.Discount, 0)         AS BIT) AS cap_discount,
        CAST(ISNULL(sa.EditPatientTests, 0) AS BIT) AS cap_edit_patient_tests,
        CAST(ISNULL(sa.Result_Entry, 0)     AS BIT) AS cap_result_entry,
        CAST(ISNULL(sa.patient_details, 0)  AS BIT) AS cap_patient_details
    FROM dbo.tbl_med_user_master u
    LEFT JOIN dbo.tbl_med_usertypes ut
        ON ut.id = u.usertypeid
    LEFT JOIN dbo.tbl_med_mcc_user_security_auth sa
        ON sa.user_type = u.usertypeid
    WHERE u.Username = @Username
      AND u.password = @Password
      AND u.IsActive = 1;
END
