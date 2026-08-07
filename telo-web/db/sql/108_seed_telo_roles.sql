/*
 * 108_seed_telo_roles.sql
 *
 * Idempotent seed of built-in Telo roles, their capability grants, and the
 * LIS usertype → Telo role defaults. Only inserts missing rows — never
 * overwrites admin edits on re-deploy.
 */
SET NOCOUNT ON;

/* ---- roles ----------------------------------------------------------- */
MERGE dbo.telo_role AS t
USING (VALUES
    (N'super_admin',      N'Super Admin',           N'All access + user management', 1),
    (N'admin',            N'Admin',                 N'Everything except user management', 1),
    (N'billing',          N'Billing',               N'Register + accession + payments', 1),
    (N'b2c_billing',      N'B2C Billing',           N'Billing — B2C New order tab only', 1),
    (N'b2b_billing',      N'B2B Billing',           N'Client — B2B Patient Orders tab only', 1),
    (N'client',           N'Client',                N'Billing + own Sales & Accounts', 1),
    (N'client_reporting', N'Client Reporting',      N'Client home + Reporting (own reports)', 1),
    (N'report_admin',     N'Reporting (all clients)', N'Reporting for every client code', 1),
    (N'technician',       N'Technician',            N'Accession SIDs only', 1),
    (N'viewer',           N'Viewer',                N'Read-only', 1)
) AS s (role_key, label, description, is_builtin)
ON t.role_key = s.role_key
WHEN NOT MATCHED THEN
    INSERT (role_key, label, description, is_active, is_builtin)
    VALUES (s.role_key, s.label, s.description, 1, s.is_builtin);

/* ---- capabilities (insert-missing only) ------------------------------ */
;WITH caps (role_key, capability) AS (
    SELECT * FROM (VALUES
        -- super_admin
        (N'super_admin', N'user:manage'),
        (N'super_admin', N'order:create'),
        (N'super_admin', N'order:accession'),
        (N'super_admin', N'order:view'),
        (N'super_admin', N'order:b2c'),
        (N'super_admin', N'order:b2b'),
        (N'super_admin', N'order:discount'),
        (N'super_admin', N'patient:create'),
        (N'super_admin', N'patient:view'),
        (N'super_admin', N'bill:view'),
        (N'super_admin', N'payment:capture'),
        (N'super_admin', N'payment:refund'),
        (N'super_admin', N'rate:view'),
        (N'super_admin', N'rate:manage'),
        (N'super_admin', N'balance:view'),
        (N'super_admin', N'account:view'),
        (N'super_admin', N'account:manage'),
        (N'super_admin', N'sales:view'),
        (N'super_admin', N'dashboard:view'),
        (N'super_admin', N'report:view'),
        -- admin
        (N'admin', N'order:create'),
        (N'admin', N'order:accession'),
        (N'admin', N'order:view'),
        (N'admin', N'order:b2c'),
        (N'admin', N'order:b2b'),
        (N'admin', N'order:discount'),
        (N'admin', N'patient:create'),
        (N'admin', N'patient:view'),
        (N'admin', N'bill:view'),
        (N'admin', N'payment:capture'),
        (N'admin', N'rate:view'),
        (N'admin', N'rate:manage'),
        (N'admin', N'balance:view'),
        (N'admin', N'account:view'),
        (N'admin', N'sales:view'),
        (N'admin', N'dashboard:view'),
        -- billing
        (N'billing', N'order:create'),
        (N'billing', N'order:accession'),
        (N'billing', N'order:view'),
        (N'billing', N'order:b2c'),
        (N'billing', N'order:b2b'),
        (N'billing', N'order:discount'),
        (N'billing', N'patient:create'),
        (N'billing', N'patient:view'),
        (N'billing', N'bill:view'),
        (N'billing', N'payment:capture'),
        (N'billing', N'rate:view'),
        (N'billing', N'balance:view'),
        (N'billing', N'dashboard:view'),
        -- b2c_billing
        (N'b2c_billing', N'order:create'),
        (N'b2c_billing', N'order:accession'),
        (N'b2c_billing', N'order:view'),
        (N'b2c_billing', N'order:b2c'),
        (N'b2c_billing', N'order:discount'),
        (N'b2c_billing', N'patient:create'),
        (N'b2c_billing', N'patient:view'),
        (N'b2c_billing', N'bill:view'),
        (N'b2c_billing', N'payment:capture'),
        (N'b2c_billing', N'rate:view'),
        (N'b2c_billing', N'balance:view'),
        (N'b2c_billing', N'dashboard:view'),
        -- b2b_billing
        (N'b2b_billing', N'order:create'),
        (N'b2b_billing', N'order:accession'),
        (N'b2b_billing', N'order:view'),
        (N'b2b_billing', N'order:b2b'),
        (N'b2b_billing', N'order:discount'),
        (N'b2b_billing', N'patient:create'),
        (N'b2b_billing', N'patient:view'),
        (N'b2b_billing', N'bill:view'),
        (N'b2b_billing', N'payment:capture'),
        (N'b2b_billing', N'rate:view'),
        (N'b2b_billing', N'balance:view'),
        (N'b2b_billing', N'account:view'),
        (N'b2b_billing', N'sales:view'),
        (N'b2b_billing', N'dashboard:view'),
        -- client
        (N'client', N'order:create'),
        (N'client', N'order:accession'),
        (N'client', N'order:view'),
        (N'client', N'order:b2c'),
        (N'client', N'order:b2b'),
        (N'client', N'order:discount'),
        (N'client', N'patient:create'),
        (N'client', N'patient:view'),
        (N'client', N'bill:view'),
        (N'client', N'payment:capture'),
        (N'client', N'rate:view'),
        (N'client', N'balance:view'),
        (N'client', N'account:view'),
        (N'client', N'sales:view'),
        (N'client', N'dashboard:view'),
        -- client_reporting / report_admin
        (N'client_reporting', N'report:view'),
        (N'report_admin', N'report:view'),
        -- technician
        (N'technician', N'order:accession'),
        (N'technician', N'order:view'),
        (N'technician', N'order:b2c'),
        (N'technician', N'patient:view'),
        -- viewer
        (N'viewer', N'order:view'),
        (N'viewer', N'order:b2c'),
        (N'viewer', N'patient:view'),
        (N'viewer', N'bill:view'),
        (N'viewer', N'rate:view'),
        (N'viewer', N'balance:view'),
        (N'viewer', N'account:view'),
        (N'viewer', N'sales:view'),
        (N'viewer', N'dashboard:view')
    ) AS v(role_key, capability)
)
INSERT INTO dbo.telo_role_capability (role_key, capability)
SELECT c.role_key, c.capability
FROM caps c
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.telo_role_capability x
    WHERE x.role_key = c.role_key AND x.capability = c.capability
);

/* ---- LIS usertype → Telo role defaults (insert-missing) -------------- */
MERGE dbo.telo_lis_usertype_role AS t
USING (VALUES
    (1,  N'super_admin'),
    (5,  N'admin'),
    (26, N'admin'),
    (28, N'admin'),
    (32, N'admin'),
    (2,  N'b2b_billing'),
    (7,  N'b2b_billing'),
    (12, N'b2b_billing'),
    (29, N'billing'),
    (33, N'billing'),
    (4,  N'technician'),
    (9,  N'technician'),
    (16, N'technician'),
    (17, N'technician'),
    (18, N'technician'),
    (20, N'technician'),
    (25, N'technician'),
    (30, N'technician'),
    (34, N'technician')
) AS s (lis_usertype_id, telo_role_key)
ON t.lis_usertype_id = s.lis_usertype_id
WHEN NOT MATCHED THEN
    INSERT (lis_usertype_id, telo_role_key)
    VALUES (s.lis_usertype_id, s.telo_role_key);

PRINT 'Seeded telo_role / capabilities / lis usertype map (insert-missing).';
