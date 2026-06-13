/* Index for the per-mobile patient cap (max 4 Telo patients per number).
   The New Order form runs a debounced COUNT per typed number, registerOrder
   re-checks on submit, and usp_telo_create_order guards inside the write —
   all filter on (mobile_number, addedby LIKE 'telo:%'). Without this index
   every check scans the shared patient master.

   tbl_med_mcc_patient_master is a shared LIS table: this is an index-only,
   additive change (no schema or data impact), but deploying it is still a
   production migration — run via `npm run deploy:sp` with authorization. */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_telo_patient_master_mobile_number'
      AND object_id = OBJECT_ID('dbo.tbl_med_mcc_patient_master')
)
    CREATE NONCLUSTERED INDEX IX_telo_patient_master_mobile_number
        ON dbo.tbl_med_mcc_patient_master (mobile_number)
        INCLUDE (addedby);
