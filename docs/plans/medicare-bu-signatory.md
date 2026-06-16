---
name: Medicare BU signatory
overview: Copy Dr Aijaz Muzamil (sigId=7, SRI NAGAR) into a new tbl_med_signature_master row for MEDICARE (BU 21) via INSERT...SELECT — original SRI NAGAR mapping untouched.
todos:
  - id: confirm-signers
    content: "Confirmed: copy Dr Aijaz Muzamil (sigId=7) from SRI NAGAR to MEDICARE BU 21."
    status: completed
  - id: author-sql
    content: "Exact INSERT...SELECT from sigId=7 with Business_Unit_id=21 (no UPDATE/DELETE on source row)."
    status: completed
  - id: authorize
    content: Get explicit authorization for the production LIS write before executing.
    status: completed
  - id: execute-verify
    content: "Done: inserted new sigId=24 (Business_Unit_id=21, Dr Aijaz Muzamil, 16704 bytes); sigId=7 unchanged on BU 5. Redis telo:report:signers:21 NOT flushed from the run host (REDIS_URL was the local box) — relies on 1h TTL or a manual flush on the prod host."
    status: completed
  - id: confirm-report
    content: Open a MEDICARE (MDCARE) SID report and confirm the new doctor sign renders instead of the fallback (after the signers cache TTL/flush).
    status: pending
---

# Add MEDICARE (BU 21) report signatory

## How LIS stores doctor signs and maps them to BUs

The mapping lives in Noble (shared LIS DB), not in Telo code. Two tables + one fallback view:

| Table / view | Role |
|---|---|
| `dbo.tbl_med_business_unit_master` | Business Units (processing centres): `id`, `BusinessUnitCode`, `BusinessUnitName`, address/phone |
| `dbo.tbl_med_signature_master` | Doctor signatures: name, designation, image (`Signature` varbinary), `Business_Unit_id` (the FK), `DOC_TYPE`, `IsActive` |
| `dbo.Department_View_Sign` | Per-department fallback signers when a BU has no configured rows |

**The mapping key is `tbl_med_signature_master.Business_Unit_id` → `tbl_med_business_unit_master.id`.**

MCC clients link to a BU via `tbl_med_mcc_unit_master.BusinessUnitCode` (stores the BU `id`). Reports resolve the sample's BU name/code, then load signers for that BU. Telo reads this in [telo-web/db/read/signatures.ts](../../telo-web/db/read/signatures.ts):

```sql
SELECT id, Doctorname, Designation, DOC_TYPE
FROM dbo.tbl_med_signature_master
WHERE Business_Unit_id = @bu
  AND ISNULL(IsActive, 1) = 1
  AND Signature IS NOT NULL
ORDER BY ISNULL(DOC_TYPE, 99), id   -- DOC_TYPE 1 = primary (left), 2 = secondary (right)
```

`tbl_med_signature_master` schema (live Noble):

| Column | Type | Notes |
|---|---|---|
| `id` | int IDENTITY | auto-generated; do not insert |
| `Doctorname` | nvarchar(100) | printed name |
| `Designation` | nvarchar(100) | e.g. "MD, Pathology Regn No.75692(DMC)" |
| `Signature` | varbinary(MAX) | PNG/JPEG image bytes |
| `IsActive` | bit | 1 = shown on reports |
| `Business_Unit_id` | int | **the BU mapping** |
| `department_id` | int | optional; Telo ignores it |
| `DOC_TYPE` | int | 1 = primary, 2 = secondary |
| `user_id`, `CreatedBy`, `CreatedDate`, etc. | | left NULL in practice |

---

## Current doctor → BU mapping (live Noble, read-only query)

### All business units (18 rows)

| buId | code | name | active | has signers? |
|---|---|---|---|---|
| 1 | QUGEN | QUGEN PATHLABS | yes | yes (6 rows, 4 active) |
| 2 | ZIRAKPUR | Zirakpur | yes | **no** → fallback |
| 3 | KHETARPAL | KHETARPAL HOSPITAL | no | yes (1 row, inactive) |
| 4 | KARNAL | GENOMICS KARNAL | yes | yes (2 active) |
| 5 | SRINAGAR | SRI NAGAR | yes | yes (2 active) |
| 6 | SAMARPAN | SAMARPAN HOSPITAL | no | **no** → fallback |
| 7 | AGRA | AGRA | yes | yes (3 rows, 1 active) |
| 8 | RAJASTHAN | RAJASTHAN | no | **no** → fallback |
| 9 | GORAKHPUR | GORAKHPUR | yes | **no** → fallback |
| 10 | Jhansi | Noble Jhansi Lab | yes | **no** → fallback |
| 13 | AMROHA | AMROHA | no | yes (1 row, inactive) |
| 14 | JAMMU | JAMMU | yes | yes (1 active) |
| 15 | Lucknow | Lucknow | yes | yes (1 active) |
| 16 | MEDSKY | MEDSKY PATH LAB & DIAGNOSTICS | yes | **no** → fallback |
| 17 | ROHTAK | ROHTAK | yes | yes (2 rows, 1 active) |
| 19 | DEHRADUN | DEHRADUN | yes | yes (1 row, inactive) |
| 20 | HALDWANI | HALDWANI | yes | **no** → fallback |
| **21** | **MEDICARE** | **MEDICARE SUPER SPECIALITY HOSPITAL** | **yes** | **no** → fallback today |

MCC on BU 21: `MDCARE` (mccId=5797, "MEDICARE SUPER SPECIALITY HOSPITAL", active).

### All signature rows (20 rows) — the actual doctor → BU mapping

Only rows with `IsActive=1` and a non-null `Signature` appear on reports. Inactive rows are listed for reference.

| sigId | buId | BU name | DOC_TYPE | active | sig size | doctor | designation |
|---|---|---|---|---|---|---|---|
| 1 | 1 | QUGEN PATHLABS | 1 (primary) | yes | 59 KB | Dr Jasneet Kaur | MD,Pathology Regn No.75692(DMC) |
| 3 | 1 | QUGEN PATHLABS | 1 (primary) | yes | 12 KB | Dr KD Gandhi | MD, Microbiology |
| 4 | 1 | QUGEN PATHLABS | 1 (primary) | **no** | 51 KB | Dr Jyoti Chakraverty | MD, Pathology |
| 2 | 1 | QUGEN PATHLABS | 2 (secondary) | yes | 62 KB | Dr Upinder Singh | DCP, MIHMEP |
| 17 | 1 | QUGEN PATHLABS | 2 (secondary) | yes | 62 KB | Dr. Upinder Singh | DCP, MIHMEP |
| 6 | 1 | QUGEN PATHLABS | 2 (secondary) | **no** | 19 KB | Dr Annu Sajeev | MD PATH,DNB PATH |
| 5 | 3 | KHETARPAL HOSPITAL | — | **no** | 14 KB | Dr Ankit | MD, Pathologist |
| 21 | 4 | GENOMICS KARNAL | 1 (primary) | yes | 2 KB | Dr Jasneet Kaur | MD,Pathology Regn No.75692(DMC) |
| 10 | 4 | GENOMICS KARNAL | 2 (secondary) | yes | 26 KB | Dr. Saurabh, MD PATHOLOGIST | REG. NO.-HN 008424 |
| 9 | 5 | SRI NAGAR | 1 (primary) | yes | 2 KB | Dr Jasneet Kaur , MD, Pathology | FRCPATH UK, Reg. No. 75692 |
| 7 | 5 | SRI NAGAR | 2 (secondary) | yes | 17 KB | Dr Aijaz Muzamil | Consultant Pathologist |
| 11 | 7 | AGRA | 1 (primary) | **no** | 109 KB | Dr Tanuja Mittal, MD | Consultant Pathologist (MCI/11-38782) |
| 12 | 7 | AGRA | 1 (primary) | **no** | 23 KB | Dr Toshi Agarwal | Consultant Pathologist, Regd. No-111243 |
| 19 | 7 | AGRA | 1 (primary) | yes | 14 KB | Dr. Divya P, MBBS MD | Consultant Pathologist |
| 15 | 13 | AMROHA | 1 (primary) | **no** | 36 KB | DR. MANISH KUMAR VARSHNEY, MBBS | MD(PATH), REG NO. 71380 |
| 14 | 14 | JAMMU | 1 (primary) | yes | 16 KB | Dr. Aneeta Singh, MD | Consultant Pathologist, (J&K 702) |
| 16 | 15 | Lucknow | 2 (secondary) | yes | 31 KB | DR. NIDA PARVEEN (MD PATH) | REGD.NO. 14834 |
| 20 | 17 | ROHTAK | 2 (secondary) | **no** | 8 KB | DR. MANSI AGARWAL | Consultant Pathologist (RG NO.:13-PGIMS-122) |
| 22 | 17 | ROHTAK | 2 (secondary) | yes | 8 KB | Dr. Radhika Vashisth | Consultant Pathologist-DNB(PATH) |
| 18 | 19 | DEHRADUN | 1 (primary) | **no** | 38 KB | Dr. Amit Goyal | MBBS MD (PATH) REG. NO.4017 |

**What actually renders per BU** (active signers only, primary → secondary, max 3):

- **BU 1 QUGEN PATHLABS**: Dr Jasneet Kaur (P) + Dr KD Gandhi (P) + Dr Upinder Singh (S) — note two primaries; ordering is by `DOC_TYPE` then `id`
- **BU 4 GENOMICS KARNAL**: Dr Jasneet Kaur (P) + Dr. Saurabh (S)
- **BU 5 SRI NAGAR**: Dr Jasneet Kaur (P) + Dr Aijaz Muzamil (S)
- **BU 7 AGRA**: Dr. Divya P (P) only
- **BU 14 JAMMU**: Dr. Aneeta Singh (P) only
- **BU 15 Lucknow**: DR. NIDA PARVEEN (S) only
- **BU 17 ROHTAK**: Dr. Radhika Vashisth (S) only
- **BU 2, 6, 8, 9, 10, 16, 20, 21**: no active signers → **fallback** (see below)

### Fallback signers (`Department_View_Sign`) — what MEDICARE gets today

When a BU has zero active signature rows (including **BU 21 MEDICARE**), reports use per-department defaults:

| department | primary | secondary |
|---|---|---|
| CLINICAL BIOCHEMISTRY, HEMATOLOGY, IMMUNOLOGY/SEROLOGY, etc. (most depts) | Dr Jasneet Kaur — MD,Pathology Regn No.75692(DMC) | Dr. Upinder Singh — DCP, MIHMEP |
| CLINICAL MICROBIOLOGY | Dr KD Gandhi — MD, Microbiology | (none) |
| ADMINISTRATION, GENERAL, LOGISTICS | (none) | (none) |

---

## MEDICARE status (the gap to fill)

- BU **already exists**: `id=21`, code `MEDICARE`, active.
- MCC client `MDCARE` (id=5797) already points to BU 21.
- **Zero rows** in `tbl_med_signature_master` for `Business_Unit_id=21`.
- To add a mapping: insert row(s) with `Business_Unit_id=21`, `IsActive=1`, a `Signature` image, and `DOC_TYPE` 1/2. `id` is IDENTITY (current max id=22).

Telo picks signers in [telo-web/db/read/signatures.ts](../../telo-web/db/read/signatures.ts) (`getSignersForBusinessUnit`): `WHERE Business_Unit_id=@bu AND IsActive=1 AND Signature IS NOT NULL ORDER BY ISNULL(DOC_TYPE,99), id`, capped at 3.

## Decision: copy Dr Aijaz Muzamil to MEDICARE

**Source row** (unchanged — SRI NAGAR keeps its mapping):

| field | value |
|---|---|
| sigId | **7** |
| buId | **5** (SRI NAGAR) |
| Doctorname | Dr Aijaz Muzamil |
| Designation | Consultant Pathologist |
| DOC_TYPE | 2 (secondary) |
| IsActive | 1 |
| Signature | 16,704 bytes |
| department_id | NULL |

**Target**: new row with `Business_Unit_id = 21` (MEDICARE), all other copied fields identical.

**Why SRI NAGAR is unaffected**: we **INSERT a new row only**. We do **not** UPDATE, DELETE, or move sigId=7. After the copy:

- sigId=7 remains `Business_Unit_id=5` → SRI NAGAR reports still show Dr Jasneet Kaur (P) + Dr Aijaz Muzamil (S)
- New sigId (likely 23) gets `Business_Unit_id=21` → MEDICARE reports show Dr Aijaz Muzamil instead of the head-office fallback

## Exact SQL (production — gated)

**Pre-check** (read-only):

```sql
-- Source row must still exist on SRI NAGAR
SELECT id, Business_Unit_id, Doctorname, Designation, DOC_TYPE, IsActive,
       DATALENGTH(Signature) AS sigBytes
FROM dbo.tbl_med_signature_master WHERE id = 7;

-- MEDICARE must have zero rows today
SELECT COUNT(*) AS medicareSigs FROM dbo.tbl_med_signature_master WHERE Business_Unit_id = 21;
```

**Insert** (the only write):

```sql
INSERT INTO dbo.tbl_med_signature_master
  (Doctorname, Designation, Signature, IsActive, Business_Unit_id, DOC_TYPE)
SELECT
  Doctorname, Designation, Signature, IsActive, 21, DOC_TYPE
FROM dbo.tbl_med_signature_master
WHERE id = 7;
```

Copies: name, designation, signature image bytes, `IsActive`, `DOC_TYPE`. Only `Business_Unit_id` changes (5 → 21). `id` is IDENTITY (new row, expected id=23). `department_id` stays omitted (NULL, same as source).

**Post-verify**:

```sql
-- SRI NAGAR unchanged
SELECT id, Business_Unit_id, Doctorname, IsActive
FROM dbo.tbl_med_signature_master WHERE id = 7;
-- expect: buId=5, active=1

-- MEDICARE new row
SELECT id, Business_Unit_id, Doctorname, Designation, DOC_TYPE, IsActive,
       DATALENGTH(Signature) AS sigBytes
FROM dbo.tbl_med_signature_master WHERE Business_Unit_id = 21;
-- expect: 1 row, Dr Aijaz Muzamil, DOC_TYPE=2, sigBytes=16704
```

**Rollback** (if needed):

```sql
-- Delete only the new MEDICARE row (never touch id=7)
DELETE FROM dbo.tbl_med_signature_master
WHERE Business_Unit_id = 21 AND Doctorname = N'Dr Aijaz Muzamil';
```

## Execute + verify (gated — production LIS write)

- Run the INSERT against Noble via the same `nobleone` pool used for the read-only inspection.
- Run pre-check + post-verify queries above; confirm sigId=7 still on buId=5.
- Cache gotcha: Telo caches signers for 1h (Redis key `telo:report:signers:21`). Flush that key or wait out the TTL, then open a MEDICARE report (`/print/reporting/[sid]` for an MDCARE SID) to confirm Dr Aijaz Muzamil renders instead of the fallback.

## Expected outcome after insert

| BU | sigId | signers on report |
|---|---|---|
| 5 SRI NAGAR | 7 (unchanged) | Dr Jasneet Kaur (P) + Dr Aijaz Muzamil (S) |
| 21 MEDICARE | new (~23) | Dr Aijaz Muzamil (S) only — no more head-office fallback |

## Guardrails

- This writes to the shared production LIS table — per [CLAUDE.md](../../CLAUDE.md) it requires explicit go-ahead before executing.
- **INSERT only** — never UPDATE/DELETE sigId=7; SRI NAGAR mapping must remain intact.
- Reversible: delete the new MEDICARE row (see rollback SQL) or set `IsActive=0` on it.
