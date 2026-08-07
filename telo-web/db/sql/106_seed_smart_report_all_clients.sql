/*
 * 106_seed_smart_report_all_clients.sql — the 'Smart Report' Telo-only test,
 * offered to EVERY client code at a flat ₹99.
 *
 * Unlike the previous custom tests (Glucose/VBG - External, MDCARE-only),
 * Smart Report is network-wide. Rather than seeding ~3.5k per-client rows,
 * client_code carries the sentinel '*' meaning "offered for every client" —
 * db/read/customTests.ts includes '*' rows for any client it is asked about
 * ('*' can never collide with a real MCCUnitCode).
 *
 * Buying it is what unlocks the patient-friendly Smart Report button on that
 * patient's report (see telo_custom_test_order + the reporting gate): billed
 * by Telo, performed by no one — it's a report format, not a lab test, so as
 * ever there is NO link to tbl_med_test_master.
 *
 * Idempotent — a re-deploy is a no-op.
 */
IF NOT EXISTS (
    SELECT 1 FROM dbo.telo_custom_test
    WHERE code = N'SMART-RPT' AND client_code = N'*' AND is_active = 1
)
    INSERT INTO dbo.telo_custom_test (code, name, mrp, client_code, requires_mrd, allow_qty, is_active)
    VALUES (N'SMART-RPT', N'Smart Report', 99, N'*', 0, 0, 1);
