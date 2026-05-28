/*
 * 10_table_telo_user_session_version.sql
 *
 * One row per Telo user whose effective access has been changed by an admin
 * action — role change, deactivation, password reset, profile update.
 * Each such action bumps `version`; the auth layer caches a per-user version
 * snapshot in Redis (30s TTL) and refuses to honour a JWT whose embedded
 * version is stale.
 *
 * Why a separate table (vs a column on tbl_telo_user_role):
 *   - The role table only carries rows for users with an explicit Telo role;
 *     LIS-derived users have no row, but deactivation still has to revoke
 *     their session immediately.
 *   - Keeping it independent means we never touch the role-assignment
 *     write path or risk a phantom role assignment on deactivation.
 *
 * Telo-owned table only — no Noble (LIS) DDL.
 * Idempotent — safe to re-run.
 */
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo' AND t.name = 'telo_user_session_version'
)
BEGIN
    CREATE TABLE dbo.telo_user_session_version (
        user_id    INT          NOT NULL PRIMARY KEY,
        version    INT          NOT NULL DEFAULT 0,
        updated_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by INT          NULL
    );
    PRINT 'Created dbo.telo_user_session_version.';
END
ELSE
BEGIN
    PRINT 'dbo.telo_user_session_version already present.';
END
