/* ── 07_alter_telo_mcc_invoice_config_add_logo.sql ────────────────────────── *
 * Adds an optional top-right logo (bytes + mime) per MCC for invoice headers.
 * Touches ONLY the Telo-owned dbo.telo_mcc_invoice_config table; NO LIS DDL.
 * Idempotent — safe to re-run.
 * ─────────────────────────────────────────────────────────────────────────── */

IF COL_LENGTH('dbo.telo_mcc_invoice_config', 'top_right_logo_bytes') IS NULL
  ALTER TABLE dbo.telo_mcc_invoice_config
    ADD top_right_logo_bytes VARBINARY(MAX) NULL;

IF COL_LENGTH('dbo.telo_mcc_invoice_config', 'top_right_logo_mime') IS NULL
  ALTER TABLE dbo.telo_mcc_invoice_config
    ADD top_right_logo_mime NVARCHAR(64) NULL;
