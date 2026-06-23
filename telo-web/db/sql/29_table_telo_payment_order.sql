/*
 * 29_table_telo_payment_order.sql
 *
 * Sidecar table tracking every ONLINE (CCAvenue) client-payment attempt that
 * Telo initiates. One row per `order_id` we send to the gateway. It is the
 * trust anchor for the asynchronous callback:
 *
 *   - At INITIATE (app/api/ccavenue/initiate) we INSERT a PENDING row binding
 *     order_id → (mcc, user_id, amount). The amount/mcc/user are NEVER taken
 *     from the browser-posted callback — only from this row — so a tampered or
 *     replayed callback cannot post an arbitrary amount to an arbitrary client.
 *   - At CALLBACK (app/api/ccavenue/callback) the idempotent SP
 *     usp_telo_record_mcc_online_payment looks the row up, posts the wallet
 *     credit exactly once (posted=1), and flips status to SUCCESS/FAILURE/
 *     ABORTED. A duplicate/replayed callback for an already-posted order is a
 *     no-op (already_recorded=1).
 *
 * This is a Telo-owned sidecar (telo_* namespace) — it does NOT touch the
 * shared LIS account tables; the SP does that. Safe to deploy on its own.
 *
 * Idempotent to DEPLOY (guarded create / additive only).
 */

IF OBJECT_ID('dbo.telo_payment_order', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.telo_payment_order (
        order_id     VARCHAR(30)  NOT NULL
            CONSTRAINT PK_telo_payment_order PRIMARY KEY,
        mcc          INT          NOT NULL,   -- tbl_med_mcc_unit_master.id
        user_id      INT          NOT NULL,   -- the client account that initiated it (origin marker)
        amount       INT          NOT NULL,   -- rupees we asked the gateway to collect
        status       VARCHAR(12)  NOT NULL
            CONSTRAINT DF_telo_payment_order_status DEFAULT 'PENDING',
            -- PENDING · SUCCESS · FAILURE · ABORTED · INVALID
        tracking_id  VARCHAR(40)  NULL,        -- CCAvenue tracking_id (their txn ref)
        bank_ref     VARCHAR(60)  NULL,        -- bank_ref_no / RRN
        payment_mode VARCHAR(40)  NULL,        -- Net Banking / Credit Card / UPI / …
        paid_amount  INT          NULL,        -- amount the gateway reports actually charged
        posted       BIT          NOT NULL
            CONSTRAINT DF_telo_payment_order_posted DEFAULT 0,
        detail_id    INT          NULL,        -- tbl_med_mcc_account_detail.id we created
        created_at   DATETIME2    NOT NULL
            CONSTRAINT DF_telo_payment_order_created DEFAULT SYSDATETIME(),
        updated_at   DATETIME2    NOT NULL
            CONSTRAINT DF_telo_payment_order_updated DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_telo_payment_order_mcc ON dbo.telo_payment_order (mcc);
    CREATE INDEX IX_telo_payment_order_created ON dbo.telo_payment_order (created_at);
END
GO
