/*
 * 103_table_telo_custom_test.sql — Telo-only test catalog + per-order log.
 *
 *   dbo.telo_custom_test        — the definition (name, MRP, which client_code
 *                                 it's offered for, whether MRD is required,
 *                                 whether multiple counts are allowed).
 *   dbo.telo_custom_test_order  — one row per custom line actually billed, with
 *                                 an MRD snapshot, so these "billed-but-not-
 *                                 performed-on-our-LIS" charges stay queryable
 *                                 without ever touching the LIS test tables.
 *
 * A custom test deliberately has NO link to tbl_med_test_master — it is not a
 * lab test in our LIS. It only ever produces a billing line. All guards are
 * idempotent (IF NOT EXISTS / IF COL_LENGTH), so a re-deploy is a no-op.
 *
 * Seeded row: 'Glucose - External' (₹60) for client code MDCARE (MEDICARE SUPER
 * SPECIALITY HOSPITAL) — performed by hospital staff, billed by us, MRD required,
 * multiple counts allowed.
 */

IF OBJECT_ID(N'dbo.telo_custom_test', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.telo_custom_test (
        id           INT IDENTITY(1,1) NOT NULL
                     CONSTRAINT PK_telo_custom_test PRIMARY KEY,
        code         NVARCHAR(50)  NOT NULL,   -- synthetic; never an LIS TestCode
        name         NVARCHAR(200) NOT NULL,
        mrp          INT           NOT NULL,   -- rupees
        client_code  NVARCHAR(50)  NOT NULL,   -- MCCUnitCode this is offered for
        requires_mrd BIT           NOT NULL CONSTRAINT DF_telo_custom_test_reqmrd DEFAULT (0),
        allow_qty    BIT           NOT NULL CONSTRAINT DF_telo_custom_test_qty    DEFAULT (0),
        is_active    BIT           NOT NULL CONSTRAINT DF_telo_custom_test_active DEFAULT (1),
        created_at   DATETIME      NOT NULL CONSTRAINT DF_telo_custom_test_cat    DEFAULT (GETDATE())
    );
    -- One active definition per (code, client_code).
    CREATE UNIQUE INDEX UX_telo_custom_test_code_client
        ON dbo.telo_custom_test (code, client_code) WHERE is_active = 1;
    -- Lookup path: "active custom tests for this client".
    CREATE INDEX IX_telo_custom_test_client
        ON dbo.telo_custom_test (client_code, is_active);
END

IF OBJECT_ID(N'dbo.telo_custom_test_order', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.telo_custom_test_order (
        id             INT IDENTITY(1,1) NOT NULL
                       CONSTRAINT PK_telo_custom_test_order PRIMARY KEY,
        bill_id        INT           NOT NULL,
        patient_id     INT           NOT NULL,
        custom_test_id INT           NOT NULL,
        code           NVARCHAR(50)  NOT NULL,
        name           NVARCHAR(200) NOT NULL,
        unit_amount    INT           NOT NULL,
        qty            INT           NOT NULL,
        mrd            NVARCHAR(200) NULL,       -- MRD snapshot at order time
        mcc_code       INT           NOT NULL,
        created_by     NVARCHAR(50)  NOT NULL,   -- 'telo:<userId>'
        created_at     DATETIME      NOT NULL CONSTRAINT DF_telo_custom_test_order_cat DEFAULT (GETDATE())
    );
    CREATE INDEX IX_telo_custom_test_order_bill    ON dbo.telo_custom_test_order (bill_id);
    CREATE INDEX IX_telo_custom_test_order_patient ON dbo.telo_custom_test_order (patient_id);
END

/* Seed: Glucose - External @ ₹60 for MDCARE. Idempotent — only inserts if an
   active row for (code, client_code) is not already present. */
IF NOT EXISTS (
    SELECT 1 FROM dbo.telo_custom_test
    WHERE code = N'GLUC-EXT' AND client_code = N'MDCARE' AND is_active = 1
)
    INSERT INTO dbo.telo_custom_test (code, name, mrp, client_code, requires_mrd, allow_qty, is_active)
    VALUES (N'GLUC-EXT', N'Glucose - External', 60, N'MDCARE', 1, 1, 1);
