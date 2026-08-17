/*
 * billnumber_unique_index.sql
 *
 * ⚠️  ALTERS THE LIVE BILLING TABLE. Run billnumber_uniqueness_dryrun.sql first.
 *
 * Makes (mcc_code, bill_number) unique, so no application — Telo, Infinity,
 * Listec, or anything added later — can issue a bill number that is already in
 * use at that centre. A constraint is the only thing that holds regardless of
 * which code path does the insert.
 *
 * TWO OPTIONS BELOW. Pick ONE and delete or leave commented the other.
 *
 * ===========================================================================
 * OPTION A — FORWARD-ONLY (recommended)
 * ===========================================================================
 * A filtered unique index covering only bills dated on or after a cutoff.
 *
 * Why this is the better trade as measured on 2026-08-17:
 *
 *   - Zero cleanup. There were 0 duplicates at or after 2026-09-01, so it can
 *     be created immediately with no renumbering at all.
 *   - It does not rewrite history. The full index needs 646 rows renumbered
 *     across 24 centres, and they are old — 220 rows from 2019-06, 163 from
 *     2023-01. Those bills were printed and filed years ago; changing their
 *     numbers now makes the database disagree with the paper copy.
 *   - It protects exactly what is at risk. Every duplicate in the table is
 *     Listec-origin and historical. Nothing is gained by enforcing uniqueness
 *     over bills nobody will ever issue again.
 *
 * Set the cutoff to the FIRST DAY OF A MONTH THAT HAS NOT STARTED. Mid-month
 * is worse: bill numbers are allocated per month, so a cutoff inside a month
 * splits one centre's sequence across the boundary and half of it is
 * unprotected for no benefit.
 *
 * A filtered predicate must be a simple comparison against a constant. That is
 * why the filter is a date and not, say, "only telo:/inf: bills" — filtered
 * index predicates do not allow LIKE.
 *
 * ===========================================================================
 * OPTION B — WHOLE TABLE
 * ===========================================================================
 * Unfiltered. Requires billnumber_dedupe.sql to have run successfully first,
 * and will fail outright if any duplicate remains. Choose this only if history
 * genuinely has to be unique too.
 *
 * ===========================================================================
 * WHAT EITHER OPTION MEANS FOR THE THREE WRITERS
 * ===========================================================================
 *   Telo, Infinity   Safe, provably. usp_telo_next_bill_number is MAX+1 within
 *                    the month band under an app-lock keyed on centre+month,
 *                    so the number it returns is above every number already in
 *                    use at that centre. It cannot violate this index. No Telo
 *                    procedure resolves a bill by number either — every write
 *                    keys on bill_id — and the reads use bill_number only for
 *                    display and for a LIKE search.
 *
 *   Listec           This is where the risk is. Its allocator is COUNT+1, not
 *                    MAX+1, so it reuses a number whenever a bill has been
 *                    deleted. Today that duplicate is written silently and the
 *                    sequence self-heals. Under this index the INSERT fails,
 *                    Bill.aspx.cs shows the raw SQL error and then clears the
 *                    form regardless, and — because COUNT+1 is deterministic
 *                    and the failed insert did not change the count — the
 *                    RETRY produces the same number. That centre cannot bill
 *                    until someone intervenes.
 *
 *                    Judge that against how live the path is: 0 Listec bills
 *                    in 2026-08, 2 in 2026-07, 0 in 2026-06, against ~2,400 a
 *                    month from Telo. But it is not zero, and at the last
 *                    measurement 1 of the 5 centres billing this month already
 *                    had a collision waiting for its next Listec bill.
 *
 * If a centre does wedge, the fix is to raise its numbers past the gap:
 *     UPDATE dbo.tbl_billing_patient_detail
 *     SET bill_number = <next free number in the band>
 *     WHERE id = <the bill that will not save>;
 *   -- or simply let that centre bill through Telo, which cannot collide.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-------------------------------------------------------------------------------
-- Pre-flight, common to both options.
-------------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.indexes
           WHERE name = 'UX_billing_mcc_billnumber'
             AND object_id = OBJECT_ID('dbo.tbl_billing_patient_detail'))
BEGIN
    PRINT 'UX_billing_mcc_billnumber already exists. Nothing to do.';
    RETURN;
END

-- Rows with a NULL bill_number would all collide with each other under a
-- unique index (SQL Server treats NULLs as equal for uniqueness). There were
-- none at the last measurement; stop if that has changed.
DECLARE @nulls INT = (
    SELECT COUNT(*) FROM dbo.tbl_billing_patient_detail WHERE bill_number IS NULL);

IF @nulls > 0
BEGIN
    RAISERROR('%d bills have a NULL bill_number. A unique index treats NULLs as equal, so these must be resolved first.',
              16, 1, @nulls);
    RETURN;
END
GO

-------------------------------------------------------------------------------
-- OPTION A — FORWARD-ONLY. This is the one that runs by default.
-------------------------------------------------------------------------------
DECLARE @cutoff DATE = '2026-09-01';   -- first day of a month that has not started

DECLARE @dupAfter INT = (
    SELECT COUNT(*) FROM (
        SELECT mcc_code, bill_number
        FROM dbo.tbl_billing_patient_detail
        WHERE bill_number IS NOT NULL AND bill_date >= @cutoff
        GROUP BY mcc_code, bill_number
        HAVING COUNT(*) > 1) x);

IF @dupAfter > 0
BEGIN
    RAISERROR('%d duplicate groups already exist on or after the cutoff. Move the cutoff forward or dedupe first.',
              16, 1, @dupAfter);
    RETURN;
END

-- The predicate is written as a literal rather than @cutoff: a filtered index
-- definition cannot reference a variable. Keep the two in step by hand.
CREATE UNIQUE NONCLUSTERED INDEX UX_billing_mcc_billnumber
    ON dbo.tbl_billing_patient_detail (mcc_code, bill_number)
    WHERE bill_date >= '2026-09-01';

PRINT 'Created UX_billing_mcc_billnumber (forward-only, bill_date >= 2026-09-01).';
GO

-------------------------------------------------------------------------------
-- OPTION B — WHOLE TABLE. To use it: comment out Option A above, then strip
-- the leading "-- " from each line below.
--
-- Line comments rather than a /* */ block, deliberately. sqlcmd and SSMS split
-- a script on GO BEFORE parsing it, so a GO inside a block comment tears the
-- comment in half and the file stops being valid — which is exactly what the
-- first version of this file did.
-------------------------------------------------------------------------------
-- DECLARE @dups INT = (
--     SELECT COUNT(*) FROM (
--         SELECT mcc_code, bill_number
--         FROM dbo.tbl_billing_patient_detail
--         WHERE bill_number IS NOT NULL
--         GROUP BY mcc_code, bill_number
--         HAVING COUNT(*) > 1) x);
--
-- IF @dups > 0
-- BEGIN
--     RAISERROR('%d duplicate groups remain. Run billnumber_dedupe.sql first.', 16, 1, @dups);
--     RETURN;
-- END
--
-- CREATE UNIQUE NONCLUSTERED INDEX UX_billing_mcc_billnumber
--     ON dbo.tbl_billing_patient_detail (mcc_code, bill_number);
--
-- PRINT 'Created UX_billing_mcc_billnumber (whole table).';
-- GO

-------------------------------------------------------------------------------
-- Verify.
-------------------------------------------------------------------------------
SELECT i.name, i.is_unique, i.has_filter, i.filter_definition,
       cols = STUFF((SELECT ', ' + c.name
                     FROM sys.index_columns ic
                     JOIN sys.columns c ON c.object_id = ic.object_id
                                       AND c.column_id = ic.column_id
                     WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                     ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 2, '')
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('dbo.tbl_billing_patient_detail') AND i.type > 0;
GO

/*
 * ROLLBACK
 *   DROP INDEX UX_billing_mcc_billnumber ON dbo.tbl_billing_patient_detail;
 *
 * Dropping the index is instant and lossless — it removes the constraint and
 * nothing else. If Listec starts wedging at a counter, this is the fastest way
 * to restore the previous behaviour while you decide what to do.
 */
