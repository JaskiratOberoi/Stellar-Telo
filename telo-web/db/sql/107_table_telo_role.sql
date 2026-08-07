/*
 * 107_table_telo_role.sql
 *
 * Editable Telo role definitions + capability grants + LIS→Telo default map.
 * Seeded from the historic in-code ROLE_CAPS / LIS_TO_TELO_ROLE_MAP (108_*).
 * Runtime reads these via Redis-cached helpers; code fallbacks remain if empty.
 */
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo' AND t.name = 'telo_role'
)
BEGIN
    CREATE TABLE dbo.telo_role (
        role_key     NVARCHAR(40)  NOT NULL PRIMARY KEY,
        label        NVARCHAR(100) NOT NULL,
        description  NVARCHAR(400) NULL,
        is_active    BIT           NOT NULL CONSTRAINT DF_telo_role_active DEFAULT (1),
        is_builtin   BIT           NOT NULL CONSTRAINT DF_telo_role_builtin DEFAULT (0),
        created_at   DATETIME2     NOT NULL CONSTRAINT DF_telo_role_created DEFAULT (SYSUTCDATETIME()),
        updated_at   DATETIME2     NULL,
        updated_by   INT           NULL
    );
    PRINT 'Created dbo.telo_role.';
END
ELSE
    PRINT 'dbo.telo_role already present.';

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo' AND t.name = 'telo_role_capability'
)
BEGIN
    CREATE TABLE dbo.telo_role_capability (
        role_key    NVARCHAR(40) NOT NULL,
        capability  NVARCHAR(40) NOT NULL,
        CONSTRAINT PK_telo_role_capability PRIMARY KEY (role_key, capability),
        CONSTRAINT FK_telo_role_capability_role
            FOREIGN KEY (role_key) REFERENCES dbo.telo_role (role_key)
            ON DELETE CASCADE
    );
    PRINT 'Created dbo.telo_role_capability.';
END
ELSE
    PRINT 'dbo.telo_role_capability already present.';

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo' AND t.name = 'telo_lis_usertype_role'
)
BEGIN
    CREATE TABLE dbo.telo_lis_usertype_role (
        lis_usertype_id INT          NOT NULL PRIMARY KEY,
        telo_role_key   NVARCHAR(40) NOT NULL,
        updated_at      DATETIME2    NOT NULL CONSTRAINT DF_telo_lis_map_upd DEFAULT (SYSUTCDATETIME()),
        updated_by      INT          NULL,
        CONSTRAINT FK_telo_lis_map_role
            FOREIGN KEY (telo_role_key) REFERENCES dbo.telo_role (role_key)
    );
    PRINT 'Created dbo.telo_lis_usertype_role.';
END
ELSE
    PRINT 'dbo.telo_lis_usertype_role already present.';
