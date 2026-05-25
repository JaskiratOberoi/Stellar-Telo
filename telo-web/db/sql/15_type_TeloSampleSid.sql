/*
 * 15_type_TeloSampleSid.sql — TVP for caller-supplied SIDs grouped by sample type.
 *
 * Passed to usp_telo_create_order alongside dbo.TeloTestList. One row per
 * distinct sample type in the order: which physical sample (sampleTypeId)
 * carries which scanned/entered SID (vailid). The SP recomputes the required
 * groups server-side and verifies coverage — the caller's grouping is never
 * trusted, only their SID assignments.
 *
 * sampleTypeId = -1 reserved for "Unspecified" (tests with no SampleId set
 * in tbl_med_test_master).
 */
IF TYPE_ID(N'dbo.TeloSampleSid') IS NULL
BEGIN
    CREATE TYPE dbo.TeloSampleSid AS TABLE
    (
        sampleTypeId INT          NOT NULL,
        vailid       NVARCHAR(50) NOT NULL,
        PRIMARY KEY (sampleTypeId)
    );
END
