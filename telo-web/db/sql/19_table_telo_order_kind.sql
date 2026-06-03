/*
 * 19_table_telo_order_kind.sql — tags Telo orders by workflow kind.
 *
 * B2B orders (registered via the B2B Orders tab, billed at MRP through
 * usp_telo_create_order @billAtMrp = 1) get a 'b2b' row here so the B2B worklist
 * and the New-order worklist can each list ONLY their own order type. Regular
 * "New order" registrations are NOT tagged — absence of a row means 'new'.
 *
 * Telo-owned sidecar; references tbl_billing_patient_detail.id by value (no FK,
 * to avoid coupling to an LIS table). No LIS table is touched and there is no
 * backfill — any order created before this migration is treated as 'new', which
 * is correct for every pre-existing order.
 */
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'telo_order_kind' AND type = 'U')
BEGIN
    CREATE TABLE dbo.telo_order_kind (
        bill_id    INT        NOT NULL PRIMARY KEY,
        kind       VARCHAR(8) NOT NULL,
        created_at DATETIME2  NOT NULL
                   CONSTRAINT DF_telo_order_kind_created DEFAULT SYSDATETIME()
    );
END
