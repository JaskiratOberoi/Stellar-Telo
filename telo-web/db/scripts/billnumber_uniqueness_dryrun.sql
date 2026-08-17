/*
 * billnumber_uniqueness_dryrun.sql
 *
 * READ ONLY. Changes nothing. Run this before either of its siblings:
 *   billnumber_dedupe.sql          — renumbers the duplicates
 *   billnumber_unique_index.sql    — adds the constraint
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS ABOUT
 *
 * A bill number is YYMM * 10000 + seq, unique per centre per month. It is NOT
 * globally unique and was never meant to be — the same number recurs across
 * centres by design.
 *
 * Two allocators write it, and only one of them is safe:
 *
 *   Telo/Infinity  usp_telo_next_bill_number — MAX(bill_number) + 1 within the
 *                  month's band, under an app-lock keyed on centre+month. MAX+1
 *                  is by construction above every existing number for that
 *                  centre and month, so it CANNOT produce a duplicate.
 *
 *   Listec         classBilling.GET_PATIENT_NEXT_ID — COUNT(bills this month
 *                  for this centre) + 1. A count is not a high-water mark:
 *                  delete a bill and it hands out a number that is already in
 *                  use. This is the source of every duplicate in the table.
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE MODE THE CONSTRAINT INTRODUCES — READ BEFORE DECIDING
 *
 * Today a Listec collision is written silently, the count moves on, and the
 * sequence self-heals. Under a unique index the INSERT fails instead, and
 * Bill.aspx.cs catches every exception into a label and then calls
 * ClearControls() regardless — so the operator loses the bill and sees raw SQL
 * text. Worse, count+1 is deterministic and the failed insert did not change
 * the count, so the RETRY produces the same number. That centre cannot bill
 * until someone intervenes.
 *
 * The constraint converts a silent, self-healing duplicate into a hard stop.
 * That is the whole risk, and it lands entirely on Listec's billing path.
 * Section 5 measures how live that path still is.
 * ---------------------------------------------------------------------------
 */
SET NOCOUNT ON;

PRINT '=== 1. Current state ================================================';

SELECT
    total_bills      = COUNT(*),
    distinct_numbers = COUNT(DISTINCT CONCAT(mcc_code, ':', bill_number)),
    null_numbers     = SUM(CASE WHEN bill_number IS NULL THEN 1 ELSE 0 END),
    -- Numbers that do not fit YYMM*10000+seq at all. Listec has at least one
    -- code path that writes a literal 1 (WorkOrder.cs), and a malformed number
    -- has no month band to renumber within, so it needs its own decision.
    malformed        = SUM(CASE WHEN bill_number IS NOT NULL
                                 AND (bill_number < 100000 OR bill_number > 999999999)
                                THEN 1 ELSE 0 END)
FROM dbo.tbl_billing_patient_detail;

PRINT '';
PRINT '=== 2. Duplicate inventory ==========================================';

-- The definition that matters: same centre, same number. The month is already
-- inside the number, so (mcc_code, bill_number) is the real key and no date
-- predicate is needed.
IF OBJECT_ID('tempdb..#dup') IS NOT NULL DROP TABLE #dup;

SELECT b.mcc_code, b.bill_number, copies = COUNT(*)
INTO #dup
FROM dbo.tbl_billing_patient_detail b
WHERE b.bill_number IS NOT NULL
GROUP BY b.mcc_code, b.bill_number
HAVING COUNT(*) > 1;

SELECT duplicate_groups = COUNT(*),
       rows_involved    = SUM(copies),
       rows_to_renumber = SUM(copies - 1),   -- the earliest of each group keeps its number
       worst_group      = MAX(copies)
FROM #dup;

PRINT '';
PRINT '=== 3. Duplicates by age ============================================';
PRINT 'Renumbering a bill that was printed and handed over years ago creates a';
PRINT 'discrepancy against the paper record. Age is the main input to whether';
PRINT 'that is acceptable.';

SELECT period = CONVERT(CHAR(7), b.bill_date, 126),
       rows_involved = COUNT(*),
       telo  = SUM(CASE WHEN b.addedby LIKE 'telo:%' THEN 1 ELSE 0 END),
       inf   = SUM(CASE WHEN b.addedby LIKE 'inf:%'  THEN 1 ELSE 0 END),
       listec= SUM(CASE WHEN b.addedby NOT LIKE 'telo:%'
                         AND b.addedby NOT LIKE 'inf:%' THEN 1 ELSE 0 END)
FROM dbo.tbl_billing_patient_detail b
JOIN #dup d ON d.mcc_code = b.mcc_code AND d.bill_number = b.bill_number
GROUP BY CONVERT(CHAR(7), b.bill_date, 126)
ORDER BY period DESC;

PRINT '';
PRINT '=== 4. Exactly what the dedupe would change =========================';

-- Same allocation the cleanup performs, so this preview and the write cannot
-- disagree: keep the earliest row of each group, push the rest to the top of
-- that centre's month band.
--
-- The band comes from the NUMBER, not from bill_date: the number is what has
-- to stay unique and what the operator reads, and a handful of rows have a
-- bill_date in a different month from the one encoded in their number.
IF OBJECT_ID('tempdb..#plan') IS NOT NULL DROP TABLE #plan;

WITH involved AS (
    SELECT b.id, b.mcc_code, b.bill_number, b.bill_date, b.addedby,
           band = (b.bill_number / 10000) * 10000,
           -- Oldest row of the group keeps the number; ties broken by id, which
           -- is the insertion order and therefore who had it first.
           keep_rank = ROW_NUMBER() OVER (
               PARTITION BY b.mcc_code, b.bill_number ORDER BY b.id)
    FROM dbo.tbl_billing_patient_detail b
    JOIN #dup d ON d.mcc_code = b.mcc_code AND d.bill_number = b.bill_number
    WHERE b.bill_number BETWEEN 100000 AND 999999999   -- malformed handled separately
),
losers AS (
    SELECT *, seq = ROW_NUMBER() OVER (PARTITION BY mcc_code, band ORDER BY id)
    FROM involved
    WHERE keep_rank > 1
),
-- High-water mark per centre per band, over ALL bills, not just duplicated
-- ones. Starting above it is what guarantees the new number is free.
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

SELECT rows_that_would_change = COUNT(*),
       centres_affected       = COUNT(DISTINCT mcc_code),
       -- Must be 0. Anything else means the allocation overflowed its month
       -- band (seq past 9999) and the cleanup must not run.
       overflowed_band        = SUM(CASE WHEN new_number / 10000 <> old_number / 10000
                                         THEN 1 ELSE 0 END),
       telo_or_inf_rows       = SUM(CASE WHEN addedby LIKE 'telo:%'
                                          OR addedby LIKE 'inf:%' THEN 1 ELSE 0 END)
FROM #plan;

PRINT '';
PRINT '-- Sample of 20 proposed changes --';
SELECT TOP 20 id, mcc_code, old_number, new_number,
       bill_date = CONVERT(CHAR(10), bill_date, 126), addedby
FROM #plan ORDER BY bill_date DESC, id;

PRINT '';
PRINT '-- Safety check: would any new number collide with something existing? --';
SELECT new_number_collisions = COUNT(*)
FROM #plan p
WHERE EXISTS (SELECT 1 FROM dbo.tbl_billing_patient_detail x
              WHERE x.mcc_code = p.mcc_code AND x.bill_number = p.new_number)
   OR EXISTS (SELECT 1 FROM #plan q
              WHERE q.mcc_code = p.mcc_code AND q.new_number = p.new_number
                AND q.id <> p.id);

PRINT '';
PRINT '-- Safety check: nothing outside this table keys on bill_number, but --';
PRINT '-- confirm no receipts or test rows are reached via the number.      --';
SELECT receipts_on_affected_bills =
         (SELECT COUNT(*) FROM dbo.tbl_billing_patient_amount_receipt r
          JOIN #plan p ON p.id = r.bill_id),
       tests_on_affected_bills =
         (SELECT COUNT(*) FROM dbo.tbl_billing_patient_test_detail t
          JOIN #plan p ON p.id = t.billid);

PRINT '';
PRINT '=== 5. Is Listec still billing? =====================================';
PRINT 'This decides whether the constraint is safe to enforce at all.';

SELECT period = CONVERT(CHAR(7), bill_date, 126),
       bills  = COUNT(*),
       telo   = SUM(CASE WHEN addedby LIKE 'telo:%' THEN 1 ELSE 0 END),
       inf    = SUM(CASE WHEN addedby LIKE 'inf:%'  THEN 1 ELSE 0 END),
       listec = SUM(CASE WHEN addedby NOT LIKE 'telo:%'
                          AND addedby NOT LIKE 'inf:%' THEN 1 ELSE 0 END)
FROM dbo.tbl_billing_patient_detail
WHERE bill_date >= DATEADD(MONTH, -6, GETDATE())
GROUP BY CONVERT(CHAR(7), bill_date, 126)
ORDER BY period DESC;

PRINT '';
PRINT '-- Replay both allocators for the current month: who would collide? --';

DECLARE @base   INT      = CONVERT(INT, FORMAT(GETDATE(), 'yyMM')) * 10000;
DECLARE @mstart DATETIME = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);

;WITH per_mcc AS (
    SELECT mcc_code, cnt = COUNT(*), mx = MAX(bill_number)
    FROM dbo.tbl_billing_patient_detail
    WHERE addeddate >= @mstart
    GROUP BY mcc_code
),
flagged AS (
    SELECT p.mcc_code,
           listec_hit = CASE WHEN EXISTS (
               SELECT 1 FROM dbo.tbl_billing_patient_detail x
               WHERE x.mcc_code = p.mcc_code AND x.bill_number = @base + p.cnt + 1)
               THEN 1 ELSE 0 END,
           telo_hit   = CASE WHEN EXISTS (
               SELECT 1 FROM dbo.tbl_billing_patient_detail x
               WHERE x.mcc_code = p.mcc_code AND x.bill_number = ISNULL(p.mx, @base) + 1)
               THEN 1 ELSE 0 END
    FROM per_mcc p
)
SELECT centres_billing_this_month = COUNT(*),
       listec_next_would_collide  = SUM(listec_hit),
       telo_next_would_collide    = SUM(telo_hit)   -- must be 0; MAX+1 cannot collide
FROM flagged;

PRINT '';
PRINT '=== 6. Forward-only alternative =====================================';
PRINT 'A filtered unique index on bill_date >= a cutoff enforces uniqueness';
PRINT 'from that date without renumbering a single historical bill. Filtered';
PRINT 'predicates allow a simple comparison like this (they do NOT allow LIKE,';
PRINT 'which is why "unique only for telo:/inf: bills" is not expressible).';
PRINT 'This is the option that needs no cleanup at all.';

SELECT cutoff = '2026-09-01',
       duplicates_at_or_after_cutoff = COUNT(*)
FROM (SELECT b.mcc_code, b.bill_number
      FROM dbo.tbl_billing_patient_detail b
      WHERE b.bill_number IS NOT NULL AND b.bill_date >= '2026-09-01'
      GROUP BY b.mcc_code, b.bill_number
      HAVING COUNT(*) > 1) x;

DROP TABLE #dup;
DROP TABLE #plan;

PRINT '';
PRINT 'Dry run complete. Nothing was modified.';
