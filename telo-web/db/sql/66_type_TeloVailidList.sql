/*
 * 66_type_TeloVailidList.sql — TVP: a batch of Sample IDs (barcodes) to
 * accession. Used by dbo.usp_telo_accession_samples.
 *
 * Types cannot be ALTERed in place; guard so re-running the deploy is safe.
 */
IF TYPE_ID(N'dbo.TeloVailidList') IS NULL
BEGIN
    CREATE TYPE dbo.TeloVailidList AS TABLE
    (
        vailid NVARCHAR(50) NOT NULL
    );
END
