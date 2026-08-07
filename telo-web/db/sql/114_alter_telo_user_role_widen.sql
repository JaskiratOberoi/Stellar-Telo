/*
 * 114_alter_telo_user_role_widen.sql
 *
 * Allow longer custom Telo role keys (matches dbo.telo_role.role_key).
 */
IF COL_LENGTH('dbo.tbl_telo_user_role', 'role') IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM sys.columns c
       JOIN sys.types t ON c.user_type_id = t.user_type_id
       WHERE c.object_id = OBJECT_ID('dbo.tbl_telo_user_role')
         AND c.name = 'role'
         AND t.name = 'nvarchar'
         AND c.max_length < 80 -- nvarchar(40) = 80 bytes
   )
BEGIN
    ALTER TABLE dbo.tbl_telo_user_role ALTER COLUMN role NVARCHAR(40) NOT NULL;
    PRINT 'Widened tbl_telo_user_role.role to NVARCHAR(40).';
END
ELSE
    PRINT 'tbl_telo_user_role.role already wide enough or missing.';
