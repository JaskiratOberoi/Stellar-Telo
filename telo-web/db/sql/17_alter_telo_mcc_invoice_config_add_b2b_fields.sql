/*
 * 17_alter_telo_mcc_invoice_config_add_b2b_fields.sql
 *
 * Per-MCC bill/invoice fields driving the reworked bill header & footer:
 *   city / state / pincode  — header line 2 (address block); fall back to the
 *                             LIS centre (tbl_med_mcc_unit_master) when blank.
 *   on_behalf_mode          — 'client' | 'qugen' | NULL (=auto). The "On behalf
 *                             of …" line under the total.
 *   show_disclaimer         — BIT NULL (=auto). The Noble-lab disclaimer footer.
 *   show_signatory          — BIT NULL (=auto). The Authorised Signatory block.
 *
 * Every column is NULLABLE; NULL means "auto", resolved at render time by
 * MDCARE detection (MCCUnitCode = 'MDCARE'): MDCARE → qugen / disclaimer off /
 * signatory on (exactly today's behavior); everyone else → client name /
 * disclaimer on / signatory off. So existing rows need NO backfill and MDCARE
 * stays byte-for-byte unchanged.
 *
 * Purely additive. Idempotent (each column guarded by COL_LENGTH).
 */
SET NOCOUNT ON;

IF COL_LENGTH('dbo.telo_mcc_invoice_config', 'city') IS NULL
    ALTER TABLE dbo.telo_mcc_invoice_config ADD city NVARCHAR(120) NULL;
GO
IF COL_LENGTH('dbo.telo_mcc_invoice_config', 'state') IS NULL
    ALTER TABLE dbo.telo_mcc_invoice_config ADD state NVARCHAR(120) NULL;
GO
IF COL_LENGTH('dbo.telo_mcc_invoice_config', 'pincode') IS NULL
    ALTER TABLE dbo.telo_mcc_invoice_config ADD pincode NVARCHAR(20) NULL;
GO
IF COL_LENGTH('dbo.telo_mcc_invoice_config', 'on_behalf_mode') IS NULL
    ALTER TABLE dbo.telo_mcc_invoice_config ADD on_behalf_mode VARCHAR(12) NULL;
GO
IF COL_LENGTH('dbo.telo_mcc_invoice_config', 'show_disclaimer') IS NULL
    ALTER TABLE dbo.telo_mcc_invoice_config ADD show_disclaimer BIT NULL;
GO
IF COL_LENGTH('dbo.telo_mcc_invoice_config', 'show_signatory') IS NULL
    ALTER TABLE dbo.telo_mcc_invoice_config ADD show_signatory BIT NULL;
GO
PRINT 'telo_mcc_invoice_config B2B/header fields ensured.';
GO
