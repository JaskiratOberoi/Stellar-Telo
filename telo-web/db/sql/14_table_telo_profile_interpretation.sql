/*
 * 14_table_telo_profile_interpretation.sql
 *
 * Telo-owned, profile-level clinical significance / interpretation text. Noble
 * stores interpretations only per test (tbl_med_test_master.Interpretation) and
 * has no profile-level field, so the report used to surface a constituent
 * test's interpretation mid-profile. This sidecar lets Telo hold ONE
 * interpretation per profile, shown once below the whole profile.
 *
 * Keyed by tbl_med_test_profile_master.id (== the result rows' profile_id).
 * Purely additive; touches no Noble table.
 */
IF OBJECT_ID('dbo.telo_profile_interpretation', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.telo_profile_interpretation (
        profile_id     INT            NOT NULL PRIMARY KEY,
        interpretation NVARCHAR(MAX)  NULL,
        updated_by     INT            NULL,
        updated_at     DATETIME2      NOT NULL
            CONSTRAINT DF_telo_profinterp_updated DEFAULT SYSDATETIME()
    );
    PRINT 'Created dbo.telo_profile_interpretation.';
END
ELSE
    PRINT 'dbo.telo_profile_interpretation already exists; no change.';
