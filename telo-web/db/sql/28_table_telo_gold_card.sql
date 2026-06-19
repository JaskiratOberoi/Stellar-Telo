/*
 * 28_table_telo_gold_card.sql — per-bill Gold Card record (B2C New Order only).
 *
 * When an operator applies a Gold Card at registration the entire bill is
 * charged at 50% (usp_telo_create_order halves every line rate at the source,
 * so the bill header amount, the billing line items, and the LIS-facing test
 * rows are all consistently halved). This Telo sidecar stores WHICH card was
 * used so the 50% reduction is auditable. One row per bill.
 *
 * Numbered 28 so the table exists before its only writer
 * (60_usp_telo_create_order.sql) in a full lexical deploy.
 */
IF OBJECT_ID(N'dbo.telo_gold_card', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.telo_gold_card
    (
        id           INT IDENTITY(1,1) NOT NULL
                       CONSTRAINT PK_telo_gold_card PRIMARY KEY,
        bill_id      INT           NOT NULL,
        card_number  NVARCHAR(50)  NOT NULL,
        card_holder  NVARCHAR(200) NOT NULL,
        -- Reduction applied, kept for auditability / future tiers (always 50).
        discount_pct INT           NOT NULL
                       CONSTRAINT DF_telo_gold_card_pct DEFAULT (50),
        -- 'telo:<userId>' origin marker, like every other Telo-created row.
        created_by   NVARCHAR(50)  NOT NULL,
        created_at   DATETIME2(0)  NOT NULL
                       CONSTRAINT DF_telo_gold_card_at DEFAULT (SYSDATETIME())
    );
    -- One Gold Card per bill.
    CREATE UNIQUE INDEX UX_telo_gold_card_bill
        ON dbo.telo_gold_card (bill_id);
    -- Look up usage by card number (reporting / fraud checks).
    CREATE INDEX IX_telo_gold_card_number
        ON dbo.telo_gold_card (card_number);
END
