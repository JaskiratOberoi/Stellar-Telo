/* ── 08_alter_telo_mcc_invoice_config_add_logo_layout.sql ─────────────────── *
 * Per-MCC bill-header layout controls for the Noble + custom (top-right) logo.
 * - noble_logo_position: 'left' | 'right' (default 'left' when null)
 * - noble_logo_visible:  1 (default) / 0 to hide
 * - custom_logo_visible: 1 (default) / 0 to hide
 *
 * The custom logo always renders on the OPPOSITE side from Noble — there is
 * no separate position column for it. Touches ONLY the Telo-owned table; no
 * LIS DDL. Idempotent — safe to re-run.
 * ─────────────────────────────────────────────────────────────────────────── */

IF COL_LENGTH('dbo.telo_mcc_invoice_config', 'noble_logo_position') IS NULL
  ALTER TABLE dbo.telo_mcc_invoice_config
    ADD noble_logo_position NVARCHAR(8) NULL;

IF COL_LENGTH('dbo.telo_mcc_invoice_config', 'noble_logo_visible') IS NULL
  ALTER TABLE dbo.telo_mcc_invoice_config
    ADD noble_logo_visible BIT NULL;

IF COL_LENGTH('dbo.telo_mcc_invoice_config', 'custom_logo_visible') IS NULL
  ALTER TABLE dbo.telo_mcc_invoice_config
    ADD custom_logo_visible BIT NULL;
