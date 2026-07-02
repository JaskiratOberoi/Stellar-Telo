/*
 * 58_type_TeloCustomLine.sql — TVP for Telo-only ("custom") order lines.
 *
 * A custom line is a charge Telo bills but the LIS never performs: it produces
 * a billing line ONLY (tbl_billing_patient_test_detail + bill total) and NO
 * tbl_med_mcc_patient_tests / _samples row, so it never enters the LIS lab
 * workflow, worksheets, or reports. Carried alongside @items into
 * usp_telo_create_order. See dbo.telo_custom_test (103_table_telo_custom_test).
 *
 * TYPES cannot be ALTERed in place; guard so a re-deploy is a no-op. Must exist
 * BEFORE 60_usp_telo_create_order.sql (that SP takes this as a READONLY param),
 * hence the 58_ prefix (all TVPs — TeloTestList/TeloSampleSid/TeloPayment —
 * sort before 60).
 */
IF TYPE_ID(N'dbo.TeloCustomLine') IS NULL
    CREATE TYPE dbo.TeloCustomLine AS TABLE (
        customTestId INT           NOT NULL,  -- dbo.telo_custom_test.id (authoritative)
        code         NVARCHAR(50)  NOT NULL,  -- synthetic test code (never an LIS TestCode)
        name         NVARCHAR(200) NOT NULL,
        unitAmount   INT           NOT NULL,  -- price per unit, rupees (server-resolved)
        qty          INT           NOT NULL,  -- how many were done (>= 1)
        requiresMrd  BIT           NOT NULL   -- 1 => MRD (ref_customer) is mandatory
    );
