/*
 * 13_table_telo_account.sql
 *
 * Telo-owned sidecar that decouples a Telo-created account's LIS login from
 * its Telo login. The shared LIS table (tbl_med_user_master) has a single
 * IsActive bit that the legacy LIS LoginClass uses as its ONLY login gate, so
 * that bit can't double as "may use Telo" — we keep two intents here instead:
 *
 *   telo_active : may sign in to Telo (the Telo-side enable/disable switch).
 *   lis_access  : may sign in to the LIS using these credentials.
 *
 * The LIS gate stays exactly what the LIS reads — IsActive — which we keep
 * derived as (telo_active AND lis_access). So a Telo account with lis_access=0
 * has IsActive=0 and the LIS rejects it, while Telo's own authenticate proc
 * keys on telo_active and still lets the user in.
 *
 * Existence of a row here == "Telo-managed account". usp_telo_authenticate
 * uses that to decide which gate applies, so native LIS users are untouched.
 *
 * One-time backfill (guarded by the table not existing yet): every account
 * Telo created so far gets a row, keeps its current active state as
 * telo_active, and has LIS access revoked (lis_access defaults to 0, IsActive
 * forced to 0). Existing Telo users therefore keep their Telo login but can no
 * longer sign in to the LIS until an admin explicitly enables it.
 *
 * Idempotent: the whole create+backfill only runs when the table is absent.
 */
SET NOCOUNT ON;

IF OBJECT_ID('dbo.telo_account', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.telo_account (
        user_id     INT       NOT NULL PRIMARY KEY,
        telo_active BIT       NOT NULL CONSTRAINT DF_telo_account_telo_active DEFAULT 1,
        lis_access  BIT       NOT NULL CONSTRAINT DF_telo_account_lis_access  DEFAULT 0,
        created_at  DATETIME2 NOT NULL CONSTRAINT DF_telo_account_created     DEFAULT SYSDATETIME(),
        updated_at  DATETIME2 NULL
    );

    INSERT INTO dbo.telo_account (user_id, telo_active, lis_access)
    SELECT u.id, CAST(ISNULL(u.IsActive, 0) AS BIT), 0
    FROM dbo.tbl_med_user_master u
    WHERE u.createdby LIKE 'telo:%';

    UPDATE u
    SET u.IsActive = 0
    FROM dbo.tbl_med_user_master u
    JOIN dbo.telo_account a ON a.user_id = u.id;

    PRINT 'Created dbo.telo_account and revoked LIS access for existing Telo accounts.';
END
ELSE
BEGIN
    PRINT 'dbo.telo_account already present.';
END
GO
