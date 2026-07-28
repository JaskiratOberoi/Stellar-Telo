/*
 * 105_seed_vbg_external_mdcare.sql — add the Telo-only "VBG - External" test.
 *
 * A second custom (Telo-only) external test for MDCARE (MEDICARE SUPER
 * SPECIALITY HOSPITAL), modelled exactly on 'Glucose - External' (see
 * 103_table_telo_custom_test.sql): performed by hospital staff, billed by us,
 * NO link to tbl_med_test_master. MRD required, and multiple counts allowed
 * (allow_qty = 1) so several VBGs can sit on one bill via the qty counter —
 * just like Glucose - External.
 *
 *   'VBG - External' (code VBG-EXT) @ ₹1100 for client code MDCARE.
 *
 * Idempotent — only inserts if an active row for (code, client_code) isn't
 * already present, so a re-deploy is a no-op.
 */

IF NOT EXISTS (
    SELECT 1 FROM dbo.telo_custom_test
    WHERE code = N'VBG-EXT' AND client_code = N'MDCARE' AND is_active = 1
)
    INSERT INTO dbo.telo_custom_test (code, name, mrp, client_code, requires_mrd, allow_qty, is_active)
    VALUES (N'VBG-EXT', N'VBG - External', 1100, N'MDCARE', 1, 1, 1);
