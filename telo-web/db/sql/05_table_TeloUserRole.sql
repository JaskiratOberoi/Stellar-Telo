/*
 * 05_table_TeloUserRole.sql
 *
 * Telo-only mapping: LIS user_id -> one of the Telo roles
 *   ('super_admin', 'admin', 'billing', 'b2c_billing', 'b2b_billing',
 *    'client', 'client_reporting', 'technician', 'viewer').
 *
 * One row per user (UNIQUE on user_id). Authentication still flows through
 * tbl_med_user_master via usp_telo_authenticate; this table only assigns the
 * Telo-side role. Users without a row fall back to the legacy LIS-derived
 * capability set in auth/rbac.ts (zero regression). The LIS Super Admin
 * (usertypeid=1) is implicitly treated as 'super_admin' on first login so the
 * Admin panel is reachable from day one.
 *
 * Idempotent: created only if missing, so the script is safe on every deploy.
 */
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo' AND t.name = 'tbl_telo_user_role'
)
BEGIN
    CREATE TABLE dbo.tbl_telo_user_role (
        id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id     INT NOT NULL,
        role        NVARCHAR(40) NOT NULL,
        assigned_by INT NULL,
        assigned_at DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT UQ_telo_user_role_user UNIQUE (user_id)
    );
    PRINT 'Created dbo.tbl_telo_user_role.';
END
ELSE
BEGIN
    PRINT 'dbo.tbl_telo_user_role already present.';
END
