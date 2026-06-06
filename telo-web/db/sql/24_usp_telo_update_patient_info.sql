/*
 * 24_usp_telo_update_patient_info.sql
 *
 * Corrects a bill's PATIENT DEMOGRAPHICS only — name, age (+ age_type),
 * gender, mobile, email. Never touches tests, samples, SIDs, amounts, or
 * payments. Super-admin-gated at the action layer; this proc additionally
 * refuses non-Telo bills.
 *
 * Writes BOTH tables a Telo order populates (see 60_usp_telo_create_order):
 *   - tbl_billing_patient_detail  (the bill / receipt view)
 *   - tbl_med_mcc_patient_master  (the patient record the lab report / SID
 *                                  worksheet reads from — joined via medid)
 * in one transaction so the receipt and the report stay consistent.
 *
 * Marker columns: the bill's updatedby/updateddate are stamped (same as the
 * receipt/refund procs). The patient master's marker columns aren't guaranteed,
 * so they're stamped only if present (COL_LENGTH guard) — the demographic
 * update always runs regardless.
 *
 * Encodings mirror the create proc: gender 1=Male/2=Female; age_type 1=Years/
 * 2=Months/3=Days; bill mobile≤10, email≤50.
 * Returns { ok, error_code, message }.
 */
CREATE OR ALTER PROCEDURE dbo.usp_telo_update_patient_info
    @billId   INT,
    @name     NVARCHAR(100),
    @age      INT,
    @ageType  INT,
    @gender   INT,
    @mobile   NVARCHAR(20),
    @email    NVARCHAR(100),
    @userId   INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @pid INT, @addedby NVARCHAR(100);

    SELECT @pid = TRY_CONVERT(INT, b.medid), @addedby = b.addedby
    FROM dbo.tbl_billing_patient_detail b
    WHERE b.id = @billId;

    IF @addedby IS NULL
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'NOT_FOUND',
               message = N'Bill not found';
        RETURN;
    END
    IF @addedby NOT LIKE 'telo:%'
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Only Telo-created bills can be edited here.';
        RETURN;
    END
    IF LTRIM(RTRIM(ISNULL(@name, N''))) = N''
    BEGIN
        SELECT ok = CAST(0 AS BIT), error_code = 'VALIDATION',
               message = N'Patient name is required.';
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        UPDATE dbo.tbl_billing_patient_detail
        SET patientname   = LEFT(@name, 100),
            age           = @age,
            age_type      = CONVERT(VARCHAR(10), @ageType),
            gender        = @gender,
            mobile_number = LEFT(@mobile, 10),
            email         = LEFT(@email, 50),
            updatedby     = CONCAT(N'telo:', @userId),
            updateddate   = GETDATE()
        WHERE id = @billId;

        IF @pid IS NOT NULL
        BEGIN
            UPDATE dbo.tbl_med_mcc_patient_master
            SET name          = @name,
                age           = @age,
                age_type      = @ageType,
                gender        = @gender,
                mobile_number = @mobile,
                email         = @email
            WHERE id = @pid;

            -- Stamp the patient-master marker columns only if they exist.
            IF COL_LENGTH('dbo.tbl_med_mcc_patient_master', 'updatedby') IS NOT NULL
               AND COL_LENGTH('dbo.tbl_med_mcc_patient_master', 'updateddate') IS NOT NULL
            BEGIN
                DECLARE @sql NVARCHAR(400) =
                    N'UPDATE dbo.tbl_med_mcc_patient_master
                      SET updatedby = CONCAT(N''telo:'', @u), updateddate = GETDATE()
                      WHERE id = @p';
                EXEC sp_executesql @sql, N'@u INT, @p INT', @u = @userId, @p = @pid;
            END
        END

        COMMIT TRAN;

        SELECT ok = CAST(1 AS BIT), error_code = CAST(NULL AS VARCHAR(20)),
               message = CAST(NULL AS NVARCHAR(200));
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        SELECT ok = CAST(0 AS BIT), error_code = 'INTERNAL',
               message = LEFT(ERROR_MESSAGE(), 200);
    END CATCH
END
GO
