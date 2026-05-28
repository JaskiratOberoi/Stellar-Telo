/* ── 09_alter_telo_mcc_invoice_config_add_prepared_by.sql ─────────────────── *
 * Adds an optional "Prepared By" name (typically the receptionist) per MCC.
 * Rendered on the printed bill just above the Notes section.
 *
 * Touches ONLY the Telo-owned dbo.telo_mcc_invoice_config table; no LIS DDL.
 * Idempotent — safe to re-run.
 * ─────────────────────────────────────────────────────────────────────────── */

IF COL_LENGTH('dbo.telo_mcc_invoice_config', 'prepared_by') IS NULL
  ALTER TABLE dbo.telo_mcc_invoice_config
    ADD prepared_by NVARCHAR(120) NULL;
