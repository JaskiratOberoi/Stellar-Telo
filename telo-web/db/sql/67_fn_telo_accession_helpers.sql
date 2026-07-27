/*
 * 67_fn_telo_accession_helpers.sql
 *
 * Scalar helpers for dbo.usp_telo_accession_samples — direct ports of
 * MedCis.Business/Pcc/WorksheetClass.cs:
 *     GetTestNormalRanges()  -> ufn_telo_test_normal_range / ufn_telo_param_normal_range
 *     GetTestUnits()         -> ufn_telo_test_unit        / ufn_telo_param_unit
 *     GET_SAMPLE_VALUE()     -> ufn_telo_sample_value
 *
 * Range selection is PER PATIENT and must match the LIS exactly:
 *   filter on (testid|paramid) + ReportType='Report' + agetype = patient.age_type
 *   + gender = patient.gender, then take the FIRST row whose [fage, tage] band
 *   contains the patient's age, and return its `fnormal`.
 * No age-band match => empty string (the LIS returns an empty StringBuilder),
 * NOT a fallback range — inventing one would put a wrong reference interval on
 * a clinical report.
 *
 * `agetype` is nvarchar in the LIS schema and compared against the patient's
 * integer age_type stringified ("1"/"2"/"3") — mirrored here with a CAST.
 *
 * Units deliberately ignore age/gender: the LIS takes the first non-empty unit
 * for the test/param regardless of band (GetTestUnits has no patient argument).
 */

CREATE OR ALTER FUNCTION dbo.ufn_telo_test_normal_range
(
    @testid  INT,
    @age     INT,
    @ageType INT,
    @gender  INT
)
RETURNS VARCHAR(1000)
AS
BEGIN
    DECLARE @r VARCHAR(1000);
    SELECT TOP 1 @r = n.fnormal
    FROM dbo.tbl_med_test_normalranges n
    WHERE n.testid = @testid
      AND n.ReportType = N'Report'
      AND n.agetype = CAST(@ageType AS NVARCHAR(10))
      AND n.gender = @gender
      AND @age >= n.fage
      AND @age <= n.tage
    ORDER BY n.id;
    RETURN ISNULL(@r, '');
END
GO

CREATE OR ALTER FUNCTION dbo.ufn_telo_param_normal_range
(
    @paramid INT,
    @age     INT,
    @ageType INT,
    @gender  INT
)
RETURNS VARCHAR(1000)
AS
BEGIN
    DECLARE @r VARCHAR(1000);
    SELECT TOP 1 @r = n.fnormal
    FROM dbo.tbl_med_test_param_normalranges n
    WHERE n.paramid = @paramid
      AND n.ReportType = N'Report'
      AND n.agetype = CAST(@ageType AS NVARCHAR(10))
      AND n.gender = @gender
      AND @age >= n.fage
      AND @age <= n.tage
    ORDER BY n.id;
    RETURN ISNULL(@r, '');
END
GO

CREATE OR ALTER FUNCTION dbo.ufn_telo_test_unit(@testid INT)
RETURNS VARCHAR(50)
AS
BEGIN
    DECLARE @u VARCHAR(50);
    SELECT TOP 1 @u = n.unit
    FROM dbo.tbl_med_test_normalranges n
    WHERE n.testid = @testid
      AND n.unit IS NOT NULL
      AND n.unit <> N''
    ORDER BY n.id;
    RETURN ISNULL(@u, '');
END
GO

/* @testMasterId is the parameter's `TestCode` column (an id, not a code). */
CREATE OR ALTER FUNCTION dbo.ufn_telo_param_unit(@testMasterId INT, @paramid INT)
RETURNS VARCHAR(50)
AS
BEGIN
    DECLARE @u VARCHAR(50);
    SELECT TOP 1 @u = n.unit
    FROM dbo.tbl_med_test_param_normalranges n
    WHERE n.testid = @testMasterId
      AND n.paramid = @paramid
      AND n.unit IS NOT NULL
      AND n.unit <> N''
    ORDER BY n.id;
    RETURN ISNULL(@u, '');
END
GO

/* Machine/default value. The LIS stores this in the result row's
   `mobile_number` column — see the fidelity note in the SP header. */
CREATE OR ALTER FUNCTION dbo.ufn_telo_sample_value(@testid INT, @paramid INT)
RETURNS NVARCHAR(400)
AS
BEGIN
    DECLARE @v NVARCHAR(400);
    IF @paramid IS NULL
        SELECT TOP 1 @v = d.value FROM dbo.tbl_med_mcc_test_sample_data d
        WHERE d.testid = @testid AND d.paramid IS NULL ORDER BY d.id;
    ELSE
        SELECT TOP 1 @v = d.value FROM dbo.tbl_med_mcc_test_sample_data d
        WHERE d.testid = @testid AND d.paramid = @paramid ORDER BY d.id;
    RETURN ISNULL(@v, '');
END
GO
