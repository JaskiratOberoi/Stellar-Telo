/*
 * backfill_telo_report_fields.sql  —  one-off, idempotent, Telo-scoped.
 *
 * Repairs the data on already-registered Telo orders so the LIS report
 * DOWNLOAD path stops throwing NullReferenceException. Telo historically wrote
 * orders that diverged from the LIS order form in two ways the download path is
 * sensitive to:
 *
 *   1. patient_master.initial = NULL   (Telo folded the salutation into `name`).
 *      The LIS keeps the salutation in `initial` and never leaves it blank.
 *   2. patient_master.MRNID   = NULL   (Telo never set it).
 *      The LIS order form backfills MRNID = patient_id when the form left it
 *      blank (SAVE_WORK_ORDER: if(IsNullOrEmpty(item.MRNID)) MRNID = id).
 *
 * NOTE: addedby/createdby/receivedby = 'telo:<userId>' is deliberately LEFT
 * ALONE. It is the Telo origin marker that the New-Order/pending-accession
 * worklist, ledger and receipts reports key on (addedby LIKE 'telo:%'), and it
 * does NOT affect the report download (NULL initial/MRNID did). Rewriting it
 * away breaks Telo's own order discovery.
 *
 * SCOPE: strictly rows that belong to Telo — a patient whose own row, or any of
 * whose samples, was stamped 'telo:%'. Re-runnable: every UPDATE is guarded so
 * a second run is a no-op (blank-only fills only).
 *
 * Run ONCE (e.g. `npm run deploy:sp -- ./db/scripts/backfill_telo_report_fields.sql`
 * or via sqlcmd). Transactional: all-or-nothing.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRAN;

/* The set of Telo patient ids (own row OR any sample stamped telo:%). */
DECLARE @teloPatients TABLE (id INT PRIMARY KEY);
INSERT INTO @teloPatients (id)
SELECT DISTINCT pm.id
FROM dbo.tbl_med_mcc_patient_master pm
WHERE pm.addedby LIKE 'telo:%'
   OR EXISTS (SELECT 1 FROM dbo.tbl_med_mcc_patient_samples s
              WHERE s.patient_id = pm.id AND s.addedby LIKE 'telo:%');

/* Known salutations (lower-cased, with/without trailing dot) → canonical form.
   Used to lift a leading salutation out of `name` into `initial`. */
DECLARE @sal TABLE (tok NVARCHAR(20) PRIMARY KEY, norm NVARCHAR(10));
INSERT INTO @sal (tok, norm) VALUES
    (N'mr', N'Mr'),   (N'mr.', N'Mr'),
    (N'mrs', N'Mrs'), (N'mrs.', N'Mrs'),
    (N'miss', N'Miss'),
    (N'ms', N'Ms'),   (N'ms.', N'Ms'),
    (N'dr', N'Dr'),   (N'dr.', N'Dr'),
    (N'master', N'Master'), (N'mast', N'Master'),
    (N'baby', N'Baby'), (N'b/o', N'B/O'),
    (N'smt', N'Smt'), (N'smt.', N'Smt'),
    (N'kum', N'Kum'), (N'km', N'Km');

/* ---- 1) MRNID fallback (mirror the LIS order form) --------------------- */
UPDATE pm
SET pm.MRNID = CONVERT(VARCHAR(50), pm.id)
FROM dbo.tbl_med_mcc_patient_master pm
JOIN @teloPatients tp ON tp.id = pm.id
WHERE pm.MRNID IS NULL OR LTRIM(RTRIM(pm.MRNID)) = '';
PRINT CONCAT('MRNID backfilled: ', @@ROWCOUNT);

/* ---- 2) initial: lift a leading salutation out of name into `initial`, else
   derive from gender. The LIS keeps the salutation ONLY in `initial` and leaves
   `name` bare (verified: 12,691/12,694 normal authorized records have name
   WITHOUT the salutation prefix), so when a known salutation prefixes the name
   we move it into `initial` and strip it from `name`. */
UPDATE pm
SET pm.initial = CASE WHEN s.norm IS NOT NULL THEN s.norm
                      ELSE CASE pm.gender WHEN 1 THEN N'Mr'
                                          WHEN 2 THEN N'Ms'
                                          ELSE N'Mr' END END,
    pm.name    = CASE WHEN s.norm IS NOT NULL
                      THEN LTRIM(SUBSTRING(f.n, LEN(f.firsttok) + 1, 4000))
                      ELSE pm.name END
FROM dbo.tbl_med_mcc_patient_master pm
JOIN @teloPatients tp ON tp.id = pm.id
CROSS APPLY (SELECT n = LTRIM(RTRIM(pm.name))) nrm
CROSS APPLY (SELECT firsttok =
                LEFT(nrm.n, CASE WHEN CHARINDEX(N' ', nrm.n) = 0 THEN 0
                                 ELSE CHARINDEX(N' ', nrm.n) - 1 END),
             n = nrm.n) f
LEFT JOIN @sal s ON s.tok = LOWER(f.firsttok)
WHERE pm.initial IS NULL OR LTRIM(RTRIM(pm.initial)) = '';
PRINT CONCAT('initial backfilled: ', @@ROWCOUNT);

/* ---- verification (must both be 0) ------------------------------------ */
SELECT
    blank_initial = SUM(CASE WHEN initial IS NULL OR LTRIM(RTRIM(initial)) = '' THEN 1 ELSE 0 END),
    blank_mrnid   = SUM(CASE WHEN MRNID   IS NULL OR LTRIM(RTRIM(MRNID))   = '' THEN 1 ELSE 0 END),
    total         = COUNT(*)
FROM dbo.tbl_med_mcc_patient_master pm
JOIN @teloPatients tp ON tp.id = pm.id;

COMMIT;
PRINT 'backfill_telo_report_fields: committed.';
