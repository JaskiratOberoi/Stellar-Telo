/*
 * 00_schema_guard.sql — read-only pre-flight assertion.
 *
 * Verifies the Noble objects Telo depends on exist before any usp_telo_*
 * procs are deployed. Makes deployment fail fast (and loudly) if pointed at
 * the wrong database. Modifies nothing.
 */
SET NOCOUNT ON;

DECLARE @missing NVARCHAR(MAX) = N'';

DECLARE @required TABLE (obj SYSNAME);
INSERT INTO @required (obj) VALUES
    (N'dbo.tbl_med_user_master'),
    (N'dbo.tbl_med_usertypes'),
    (N'dbo.tbl_med_mcc_user_security_auth'),
    (N'dbo.tbl_med_user_sales_mcc_mapping'),
    (N'dbo.tbl_med_mcc_unit_master'),
    (N'dbo.tbl_med_test_master'),
    (N'dbo.tbl_med_test_rate_types'),
    (N'dbo.tbl_med_test_rates_with_pcc_type'),
    (N'dbo.tbl_med_mcc_test_special_rates'),
    (N'dbo.tbl_med_profile_rates_with_pcc_types'),
    (N'dbo.tbl_med_mcc_patient_master'),
    (N'dbo.tbl_med_mcc_patient_tests'),
    (N'dbo.tbl_med_mcc_patient_samples'),
    (N'dbo.tbl_med_mcc_patient_clinicaldata'),
    (N'dbo.tbl_billing_patient_detail'),
    (N'dbo.tbl_billing_patient_test_detail'),
    (N'dbo.tbl_billing_patient_amount_receipt'),
    (N'dbo.tbl_med_mcc_account_master'),
    (N'dbo.tbl_med_mcc_account_detail');

SELECT @missing = @missing + obj + N'; '
FROM @required
WHERE OBJECT_ID(obj, 'U') IS NULL;

IF LEN(@missing) > 0
BEGIN
    RAISERROR('Telo schema guard FAILED — missing Noble objects: %s', 16, 1, @missing);
END
ELSE
BEGIN
    PRINT 'Telo schema guard OK — all required Noble objects present.';
END

-- Confirm the duplicate-prevention trigger we rely on still exists & is enabled.
IF NOT EXISTS (
    SELECT 1 FROM sys.triggers t
    WHERE t.name = 'trigger_PreventDuplicate'
      AND t.parent_id = OBJECT_ID('dbo.tbl_med_mcc_patient_samples')
      AND t.is_disabled = 0
)
BEGIN
    RAISERROR('Telo schema guard WARNING — trigger_PreventDuplicate missing or disabled on tbl_med_mcc_patient_samples. vailid uniqueness is at risk.', 10, 1);
END
ELSE
BEGIN
    PRINT 'Telo schema guard OK — trigger_PreventDuplicate present and enabled.';
END
