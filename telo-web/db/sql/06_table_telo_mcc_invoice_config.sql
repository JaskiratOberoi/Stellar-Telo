/* ── telo_mcc_invoice_config ──────────────────────────────────────────────── *
 * Per-MCC invoice branding: display lab name, address, phone, email.          *
 * mcc_id is the tbl_med_mcc_unit_master.id value.                             *
 * Run once; idempotent (IF OBJECT_ID guard).                                  *
 * ─────────────────────────────────────────────────────────────────────────── */
IF OBJECT_ID('dbo.telo_mcc_invoice_config', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.telo_mcc_invoice_config (
    mcc_id      INT            NOT NULL PRIMARY KEY,
    lab_name    NVARCHAR(200)  NULL,  -- overrides MCCUnitName on the invoice
    address     NVARCHAR(500)  NULL,
    phone       NVARCHAR(50)   NULL,
    email       NVARCHAR(200)  NULL,
    created_at  DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
    updated_at  DATETIME2      NOT NULL DEFAULT GETUTCDATE()
  );
END
