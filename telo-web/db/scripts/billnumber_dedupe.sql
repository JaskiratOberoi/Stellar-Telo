/*
 * billnumber_dedupe.sql
 *
 * ⚠️  WRITES TO THE LIVE BILLING TABLE. Run billnumber_uniqueness_dryrun.sql
 *     first and read its section 3 and 4 output.
 *
 * Renumbers duplicate bill numbers so a unique index on
 * (mcc_code, bill_number) can be created over the whole table.
 *
 * ---------------------------------------------------------------------------
 * ONLY RUN THIS IF YOU HAVE DECIDED AGAINST THE FORWARD-ONLY INDEX
 *
 * As measured on 2026-08-17 there are 293 duplicate groups covering 939 rows,
 * of which 646 would be renumbered across 24 centres. They are overwhelmingly
 * OLD — 220 rows from 2019-06, 163 from 2023-01, 133 from 2019-07 — and every
 * single one is Listec-origin. Zero are Telo or Infinity.
 *
 * Those bills were printed and handed over years ago. Renumbering them makes
 * the database disagree with the paper, and 255 receipts and 456 test rows
 * hang off them. Nothing JOINS on bill_number so nothing structurally breaks —
 * but a reprint of a 2019 bill will not match the copy in the file.
 *
 * billnumber_unique_index.sql offers a forward-only filtered index that needs
 * none of this and, at the same measurement, had zero duplicates to clean.
 * Prefer it unless you specifically need history to be unique too.
 * ---------------------------------------------------------------------------
 *
 * Design notes:
 *
 *   - The OLDEST row of each group keeps its number (lowest id, which is
 *     insertion order). Whoever had the number first keeps it.
 *   - Everyone else is pushed to the top of that centre's month band, above
 *     the existing high-water mark, so the new number is free by construction
 *     and the bill stays in the month it belongs to.
 *   - addedby and updatedby are deliberately NOT touched. They carry the
 *     origin markers ('telo:', 'inf:') that read paths filter on, and stamping
 *     them here would both destroy Listec's own marker and misreport who
 *     created the bill. The audit trail for this change is the log table.
 *
 * Reversible: every change is written to dbo.telo_billnumber_dedupe_log with
 * both values, and the rollback statement is at the foot of this file.
 *
 * Idempotent: re-running finds no duplicates and changes nothing.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-------------------------------------------------------------------------------
-- 1. The log. Created first and outside the transaction so that a rollback of
--    the data change cannot also erase the record of what was attempted.
-------------------------------------------------------------------------------
IF OBJECT_ID('dbo.telo_billnumber_dedupe_log', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.telo_billnumber_dedupe_log (
        id          BIGINT IDENTITY(1,1) NOT NULL
                    CONSTRAINT PK_telo_billnumber_dedupe_log PRIMARY KEY,
        bill_id     INT            NOT NULL,
        mcc_code    INT            NULL,
        old_number  INT            NOT NULL,
        new_number  INT            NOT NULL,
        bill_date   DATETIME       NULL,
        addedby     VARCHAR(50)    NULL,
        run_at      DATETIME2      NOT NULL
                    CONSTRAINT DF_telo_billnumber_dedupe_log_at DEFAULT SYSUTCDATETIME(),
        run_by      NVARCHAR(128)  NOT NULL
                    CONSTRAINT DF_telo_billnumber_dedupe_log_by DEFAULT SUSER_SNAME()
    );
    PRINT 'Created dbo.telo_billnumber_dedupe_log.';
END
GO

-------------------------------------------------------------------------------
-- 2. Build the plan. Identical logic to section 4 of the dry run — if you
--    change one, change both, or the preview stops predicting the write.
--
-- NOTE ON BATCHING: there is deliberately no GO between here and the end of
-- section 4. In a script, RETURN exits only the CURRENT BATCH — so with a GO
-- after the pre-flight checks, a failed check would print its error and then
-- the apply step would run anyway, which is the exact opposite of a guard.
-- Keeping sections 2-4 in one batch is what makes RETURN abort the script.
-------------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#plan') IS NOT NULL DROP TABLE #plan;

;WITH dup AS (
    SELECT mcc_code, bill_number
    FROM dbo.tbl_billing_patient_detail
    WHERE bill_number IS NOT NULL
    GROUP BY mcc_code, bill_number
    HAVING COUNT(*) > 1
),
involved AS (
    SELECT b.id, b.mcc_code, b.bill_number, b.bill_date, b.addedby,
           band = (b.bill_number / 10000) * 10000,
           keep_rank = ROW_NUMBER() OVER (
               PARTITION BY b.mcc_code, b.bill_number ORDER BY b.id)
    FROM dbo.tbl_billing_patient_detail b
    JOIN dup d ON d.mcc_code = b.mcc_code AND d.bill_number = b.bill_number
    WHERE b.bill_number BETWEEN 100000 AND 999999999
),
losers AS (
    SELECT *, seq = ROW_NUMBER() OVER (PARTITION BY mcc_code, band ORDER BY id)
    FROM involved WHERE keep_rank > 1
),
ceiling AS (
    SELECT b.mcc_code, band = (b.bill_number / 10000) * 10000,
           top_used = MAX(b.bill_number)
    FROM dbo.tbl_billing_patient_detail b
    WHERE b.bill_number BETWEEN 100000 AND 999999999
    GROUP BY b.mcc_code, (b.bill_number / 10000) * 10000
)
SELECT l.id, l.mcc_code, l.bill_date, l.addedby,
       old_number = l.bill_number,
       new_number = c.top_used + l.seq
INTO #plan
FROM losers l
JOIN ceiling c ON c.mcc_code = l.mcc_code AND c.band = l.band;

DECLARE @rows INT = (SELECT COUNT(*) FROM #plan);
PRINT CONCAT('Planned renumberings: ', @rows);

IF @rows = 0
BEGIN
    PRINT 'No duplicates. Nothing to do.';
    RETURN;
END

-------------------------------------------------------------------------------
-- 3. Refuse to proceed unless the plan is sound. Each of these was 0 in the
--    dry run; a non-zero value means the assumptions no longer hold and the
--    write must not happen.
-------------------------------------------------------------------------------
DECLARE @overflow INT = (
    SELECT COUNT(*) FROM #plan WHERE new_number / 10000 <> old_number / 10000);

DECLARE @collides INT = (
    SELECT COUNT(*) FROM #plan p
    WHERE EXISTS (SELECT 1 FROM dbo.tbl_billing_patient_detail x
                  WHERE x.mcc_code = p.mcc_code AND x.bill_number = p.new_number)
       OR EXISTS (SELECT 1 FROM #plan q
                  WHERE q.mcc_code = p.mcc_code AND q.new_number = p.new_number
                    AND q.id <> p.id));

-- Telo and Infinity cannot produce a duplicate (MAX+1 under an app-lock), so a
-- Telo-origin row in the plan means something has changed that this script's
-- reasoning does not cover. Stop and re-examine rather than renumber a bill
-- Telo issued.
DECLARE @nonListec INT = (
    SELECT COUNT(*) FROM #plan
    WHERE addedby LIKE 'telo:%' OR addedby LIKE 'inf:%');

IF @overflow > 0 OR @collides > 0 OR @nonListec > 0
BEGIN
    RAISERROR('Pre-flight failed: overflow=%d collides=%d telo_or_inf=%d. Nothing written.',
              16, 1, @overflow, @collides, @nonListec);
    RETURN;
END

PRINT 'Pre-flight checks passed.';

-------------------------------------------------------------------------------
-- 4. Apply, logging first so the log survives even if the update fails.
-------------------------------------------------------------------------------
BEGIN TRY
    BEGIN TRAN;

    INSERT INTO dbo.telo_billnumber_dedupe_log
        (bill_id, mcc_code, old_number, new_number, bill_date, addedby)
    SELECT id, mcc_code, old_number, new_number, bill_date, addedby FROM #plan;

    UPDATE b
    SET b.bill_number = p.new_number
    FROM dbo.tbl_billing_patient_detail b
    JOIN #plan p ON p.id = b.id;

    DECLARE @updated INT = @@ROWCOUNT;

    -- Verify inside the transaction: if anything is still duplicated the write
    -- did not achieve its purpose and should not be committed.
    DECLARE @remaining INT = (
        SELECT COUNT(*) FROM (
            SELECT mcc_code, bill_number
            FROM dbo.tbl_billing_patient_detail
            WHERE bill_number IS NOT NULL
            GROUP BY mcc_code, bill_number
            HAVING COUNT(*) > 1) x);

    IF @remaining > 0
    BEGIN
        ROLLBACK;
        RAISERROR('Still %d duplicate groups after renumbering. Rolled back.', 16, 1, @remaining);
        RETURN;
    END

    COMMIT;
    PRINT CONCAT('Renumbered ', @updated, ' bills. 0 duplicate groups remain.');
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH

DROP TABLE #plan;
GO

/*
 * ROLLBACK
 *
 * Puts every renumbered bill back. Safe to run only BEFORE the unique index is
 * created — restoring the old numbers restores the duplicates, which the index
 * would then reject.
 *
 *   BEGIN TRAN;
 *   UPDATE b SET b.bill_number = l.old_number
 *   FROM dbo.tbl_billing_patient_detail b
 *   JOIN dbo.telo_billnumber_dedupe_log l ON l.bill_id = b.id
 *   WHERE b.bill_number = l.new_number;
 *   -- confirm the count, then COMMIT or ROLLBACK
 */
