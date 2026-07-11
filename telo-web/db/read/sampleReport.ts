import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { getAgeSpecificRange } from '@/db/read/ageRange';

/**
 * Full structured report for one sample (SID), reconstructed the way the LIS
 * prints it. The Listec worksheet JSON re-sorts results by testtype and drops
 * the grouping keys, so we read `tbl_med_mcc_patient_test_result` directly in
 * insertion order (= report order) and rebuild the two-level hierarchy keyed by
 * `profile_id` (the panel/profile this row belongs to):
 *
 *   Department (e.g. CLINICAL BIOCHEMISTRY)
 *     ├─ Panel                      (testtype='Profile', profile_id=N) — e.g.
 *     │    LIVER FUNCTION TEST, grouping every row sharing profile_id=N:
 *     │      ├─ child Head group     (testtype='Head' + its 'Param' rows)   e.g. BILIRUBIN
 *     │      └─ child standalone Test (testtype='Test')                      e.g. AST, ALT
 *     ├─ standalone Head group      (testtype='Head', profile_id NULL + its 'Param' rows)
 *     └─ standalone Test            (testtype='Test', profile_id NULL)
 *
 * The panel's child blocks are what the report's per-test selection toggles
 * operate on; ticking/unticking the panel cascades to all its children.
 *
 * Each test/profile carries its Method and (optional) Interpretation from
 * tbl_med_test_master; per-result Comments come from the result row. Bio-ref
 * ranges resolve to the patient's age band when possible, else the validated
 * free-text range stored on the result.
 */

export interface SampleReportRow {
  /** Uppercased test code (for matching static notes by code). */
  code: string | null;
  name: string | null;
  method: string | null;
  value: string | null;
  unit: string | null;
  range: string | null;
  abnormal: boolean;
  comments: string | null;
}

/**
 * A Culture & Sensitivity microbiology result, reconstructed from the LIS's
 * fixed parameter template (Gram stained smear / Organism Isolated / Colony
 * count / Sensitive to / Intermediate to / Resistant to / Remarks). The three
 * "… to" parameters store their antibiotic lists as newline-separated text in a
 * single value, which we split into one entry per drug so the report can print
 * the ANTIBIOGRAM as a Sensitive / Intermediate / Resistant table. A "no growth"
 * report stores the token "NOT APPLICABLE" in each field, which survives as a
 * one-element list and prints as-is.
 */
export interface CultureReport {
  /** Culture narrative lines shown above the organism/antibiogram, in LIS order:
   *  "1st Interim Report" / "2nd Interim Report" / "Final Report" (the 24h / 48h
   *  / 5-day incubation results). Label kept verbatim from the LIS parameter. */
  narratives: { label: string; value: string }[];
  gramStain: string | null;
  organism: string | null;
  colonyCount: string | null;
  remarks: string | null;
  sensitive: string[];
  intermediate: string[];
  resistant: string[];
}

export interface SampleReportGroup {
  /** Multi-parameter test title (e.g. "BILIRUBIN (TOTAL, DIRECT & INDIRECT)"). */
  title: string | null;
  /** tbl_med_test_master.id — used to look up an interpretation image attachment. */
  testId: number | null;
  method: string | null;
  interpretation: string | null;
  /** Inlined interpretation image (data-URI), when the test has one stored in
   *  tbl_med_test_master_attachment (e.g. the HBV / HCV graph). Printed below the
   *  interpretation text (some tests carry ONLY an image and no text). */
  interpretationImageDataUrl?: string | null;
  rows: SampleReportRow[];
  /** Set when this group is a Culture & Sensitivity result (any specimen). When
   *  present the report renders the structured antibiogram instead of `rows`. */
  culture?: CultureReport;
}

/** A leaf block — a multi-parameter Head test, or a single standalone Test. It
 *  appears either at the top level of a department or as a panel's child. */
export interface SampleReportBlock {
  kind: 'group' | 'single';
  group?: SampleReportGroup;
  /** For a standalone test: the row plus its own interpretation. */
  row?: SampleReportRow;
  /** tbl_med_test_master.id of a standalone test — for its interpretation image. */
  testId?: number | null;
  interpretation?: string | null;
  interpretationImageDataUrl?: string | null;
}

/** A profile panel (e.g. "LIVER FUNCTION TEST") grouping several child blocks
 *  that share its profile_id. */
export interface SampleReportPanel {
  /** tbl_med_test_profile_master.id — used to look up the profile's Telo
   *  clinical-significance interpretation. */
  profileId: number | null;
  title: string | null;
  children: SampleReportBlock[];
}

export interface SampleReportItem {
  kind: 'panel' | 'group' | 'single';
  /** kind='panel': the profile and its child blocks. */
  panel?: SampleReportPanel;
  /** kind='group': a standalone multi-parameter Head test. */
  group?: SampleReportGroup;
  /** kind='single': a standalone test row plus its own interpretation. */
  row?: SampleReportRow;
  /** tbl_med_test_master.id of a standalone test — for its interpretation image. */
  testId?: number | null;
  interpretation?: string | null;
  interpretationImageDataUrl?: string | null;
}

export interface SampleReportDepartment {
  name: string;
  items: SampleReportItem[];
}

export interface SampleReport {
  departments: SampleReportDepartment[];
  /** Distinct test codes present (for static-notes lookup). */
  codes: string[];
  /** Distinct specimen / sample types present (e.g. "Whole Blood EDTA",
   *  "Serum"), in first-seen order — shown in the report header. */
  specimens: string[];
}

interface RawRow {
  id: number;
  testtype: string | null;
  testid: number | null;
  testcode: string | null;
  testname: string | null;
  reportTestName: string | null;
  value: string | null;
  unit: string | null;
  normalRange: string | null;
  abnormal: boolean | null;
  comments: string | null;
  profileId: number | null;
  method: string | null;
  interpretation: string | null;
  deptName: string | null;
  specimen: string | null;
}

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t || null;
};

/**
 * Like clean(), but PRESERVES line breaks — used for interpretation / clinical
 * significance text, which the LIS stores with intentional paragraph and bullet
 * formatting. Normalises line endings, collapses runs of spaces/tabs within a
 * line, trims spaces around newlines, and caps blank-line runs at one. The
 * report renders this with `whitespace-pre-line` so the LIS layout carries over.
 */
const cleanMultiline = (s: string | null | undefined): string | null => {
  const t = (s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t || null;
};

/** Split a Culture & Sensitivity antibiotic-list value (the LIS stores
 *  Sensitive/Intermediate/Resistant as newline- and tab-separated drug names,
 *  some with a potency suffix like "Amikacin(++)") into trimmed, non-empty
 *  entries — one per drug. */
const splitAbxList = (s: string | null | undefined): string[] =>
  (s ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((t) => t.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

const emptyCulture = (): CultureReport => ({
  narratives: [],
  gramStain: null,
  organism: null,
  colonyCount: null,
  remarks: null,
  sensitive: [],
  intermediate: [],
  resistant: [],
});

/** If this Param row is part of the C&S template, route its value into the
 *  group's structured `culture` slot (creating it on first match). Antibiotic
 *  lists keep their per-drug line breaks; the scalar fields are collapsed. */
const applyCultureField = (group: SampleReportGroup, x: RawRow): void => {
  const key = (x.testname ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  // Culture narrative: "1st/2nd/… Interim Report" + "Final Report" (the 24h/48h/
  // 5-day incubation results). Matched by pattern so any number of interim rows
  // is handled; kept in encounter order (= LIS row order), label preserved.
  if (key.includes('interim') || key.includes('final report')) {
    const val = cleanMultiline(x.value);
    if (val) {
      (group.culture ??= emptyCulture()).narratives.push({
        label: (x.testname ?? '').replace(/\s+/g, ' ').trim(),
        value: val,
      });
    }
    return;
  }
  switch (key) {
    case 'gram stained smear':
    case 'gram stain':
      (group.culture ??= emptyCulture()).gramStain = clean(x.value);
      break;
    case 'organism isolated':
      (group.culture ??= emptyCulture()).organism = clean(x.value);
      break;
    case 'colony count':
      (group.culture ??= emptyCulture()).colonyCount = clean(x.value);
      break;
    case 'remarks':
      (group.culture ??= emptyCulture()).remarks = clean(x.value);
      break;
    case 'sensitive to':
      (group.culture ??= emptyCulture()).sensitive = splitAbxList(x.value);
      break;
    case 'intermediate to':
      (group.culture ??= emptyCulture()).intermediate = splitAbxList(x.value);
      break;
    case 'resistant to':
      (group.culture ??= emptyCulture()).resistant = splitAbxList(x.value);
      break;
    default:
      break;
  }
};

/** A group is a real C&S report only if it carries the antibiogram signature —
 *  an isolated organism or at least one sensitivity list. This guards against a
 *  non-culture multi-parameter test that merely has a "Remarks" parameter. */
const hasAntibiogram = (c: CultureReport): boolean =>
  c.organism != null ||
  c.narratives.length > 0 ||
  c.sensitive.length > 0 ||
  c.intermediate.length > 0 ||
  c.resistant.length > 0;

/** Normalise an antibiotic entry for duplicate detection: drop the potency
 *  suffix ("(++)") and all whitespace, then lowercase — so "Piperacillin
 *  /Tazobactam" and "Piperacillin/ Tazobactam(++)" collapse to one key. */
const abxKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\(\s*\++\s*\)/g, '')
    .replace(/\s+/g, '');

/** Remove an antibiotic that appears in more than one antibiogram column (or
 *  twice in the same one) — a drug can't be simultaneously sensitive and
 *  resistant. The first occurrence in Sensitive → Intermediate → Resistant
 *  order is kept; later duplicates are dropped. "NOT APPLICABLE" placeholders
 *  are left in every column. */
const dedupeAntibiogram = (c: CultureReport): void => {
  const seen = new Set<string>();
  const prune = (list: string[]): string[] =>
    list.filter((item) => {
      if (/^\s*not applicable\s*$/i.test(item)) return true;
      const key = abxKey(item);
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  c.sensitive = prune(c.sensitive);
  c.intermediate = prune(c.intermediate);
  c.resistant = prune(c.resistant);
};

// TODO(pre-prod, ~next week): partial-report authorisation gating.
// The Reporting list now shows PARTIALLY-authorised samples (>=1 authorised
// result) so a partial report can be released — see actions/reporting.actions.ts
// (hasAuthorisedResult). But this query still returns EVERY result row for the
// SID regardless of authorisation, so a partial report's PDF would also include
// the not-yet-authorised tests — which we must not release. Fix before prod:
//   - Do NOT filter on the raw tbl_med_mcc_patient_test_result.auth bit: it is
//     unreliable here (profile/Head header rows carry auth=1 while their value
//     rows carry auth=0, so filtering by it drops the values and keeps the
//     titles, producing a broken report).
//   - Instead, derive the set of authorised test codes for the SID from the
//     Listec worksheet feed (TestResult.authorized) and exclude the unauthorised
//     tests from the rendered/downloaded report — applying to BOTH the
//     authenticated download AND the public QR softcopy (/r/[sid]).
//   - Alternative (simpler, zero-leak): only ever release FULLY-authorised
//     samples — switch the list filter from "any authorised" to "all authorised"
//     (the existing `ready` flag) and leave this query as-is.
export async function getSampleReport(
  vailid: string,
  age: number | null,
  ageUnit: string | null,
): Promise<SampleReport> {
  const sidTrim = vailid.trim();
  if (!sidTrim) return { departments: [], codes: [], specimens: [] };

  const raw = await withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('sid', sql.NVarChar(50), sidTrim)
      .query<RawRow>(`
        SELECT res.id,
               res.testtype                       AS testtype,
               res.testid                         AS testid,
               res.testcode                       AS testcode,
               res.testname                       AS testname,
               m.ReportTestname                   AS reportTestName,
               res.value                          AS value,
               res.testunit                       AS unit,
               res.testnormal_range               AS normalRange,
               res.abnormal                       AS abnormal,
               res.comments                       AS comments,
               res.profile_id                     AS profileId,
               m.Method                           AS method,
               CAST(m.Interpretation AS NVARCHAR(MAX)) AS interpretation,
               d.Name                             AS deptName,
               sm.Sampletype                      AS specimen
        FROM dbo.tbl_med_mcc_patient_test_result res
        LEFT JOIN dbo.tbl_med_test_master m       ON m.id = res.testid
        LEFT JOIN dbo.tbl_med_department_master d ON d.id = m.DepartmentId
        LEFT JOIN dbo.tbl_med_sample_master sm    ON sm.id = m.SampleId
        WHERE res.vailid = @sid
        ORDER BY res.id
      `);
    return r.recordset;
  });

  // Resolve the age-appropriate range for each distinct testid once.
  const rangeByTestId = new Map<number, string | null>();
  await Promise.all(
    [...new Set(raw.map((x) => x.testid).filter((x): x is number => x != null))].map(
      async (testId) => {
        rangeByTestId.set(testId, await getAgeSpecificRange(testId, age, ageUnit));
      },
    ),
  );

  // Only narrow to the age band when the stored range is an age-banded dump
  // (Adult/Paediatric/Newborn/x years/Trimester …). Descriptive ranges
  // (Desirable/Borderline/Optimal) and gendered ranges keep their validated
  // stored text.
  const AGE_BANDED = /\b(adult|paediatric|pediatric|newborn|year|month|week|trimester)\b/i;
  const toRow = (x: RawRow): SampleReportRow => {
    // Preserve the LIS's per-band line breaks in the reference range so the
    // report can show each band on its own line (formatRange finishes the job).
    const stored = cleanMultiline(x.normalRange);
    const ageRange =
      stored && AGE_BANDED.test(stored) && x.testid != null
        ? rangeByTestId.get(x.testid) ?? null
        : null;
    return {
      code: x.testcode ? x.testcode.trim().toUpperCase() : null,
      name: clean(x.testname),
      method: clean(x.method),
      value: clean(x.value),
      unit: clean(x.unit),
      range: ageRange ?? stored,
      abnormal: x.abnormal === true,
      comments: clean(x.comments),
    };
  };

  // Count coded 'Head' rows (testtype='Head' WITH a testcode) per testid. A
  // multi-parameter test emits an empty-testcode "report name" Head followed by
  // its real coded Head(s). When there's exactly ONE coded Head (e.g. TB Gene
  // Xpert), the two collapse to a single group titled with the report name. When
  // there are MULTIPLE (e.g. CBC → Automated 5 Part Analyzer / Differential
  // Counts % / Differential Counts Absolute), each coded Head is a real
  // sub-group and must keep its own name — so we DON'T collapse those.
  const codedHeadCount = new Map<number, number>();
  for (const x of raw) {
    if (
      (x.testtype ?? '').trim() === 'Head' &&
      x.testid != null &&
      x.testcode &&
      x.testcode.trim()
    ) {
      codedHeadCount.set(x.testid, (codedHeadCount.get(x.testid) ?? 0) + 1);
    }
  }

  // Walk rows in report order, rebuilding groups, preserving department order.
  const deptOrder: string[] = [];
  const deptItems = new Map<string, SampleReportItem[]>();
  const codes = new Set<string>();
  const specimens = new Set<string>();
  // Groups that picked up a C&S field — validated (and pruned) after the walk.
  const cultureGroups: SampleReportGroup[] = [];

  const pushItem = (dept: string, item: SampleReportItem) => {
    if (!deptItems.has(dept)) {
      deptItems.set(dept, []);
      deptOrder.push(dept);
    }
    deptItems.get(dept)!.push(item);
  };

  // The active profile panel (delimited by profile_id) and, within it (or at
  // top level), the active Head group collecting its Param rows.
  let panel: { dept: string; pid: number; item: SampleReportItem } | null = null;
  let head: { tid: number | null; group: SampleReportGroup } | null = null;

  // Groups/single tests that may carry an interpretation IMAGE (stored per-test
  // in tbl_med_test_master_attachment). Collected during the walk so we can fetch
  // the (few) blobs in one query afterwards and inline them as data-URIs.
  const imageHosts: Array<{ testId: number; set: (dataUrl: string) => void }> = [];

  /** Merge a (possibly new) interpretation into a group, de-duplicated. */
  const addInterp = (group: SampleReportGroup, interp: string | null) => {
    if (!interp) return;
    if (!group.interpretation) group.interpretation = interp;
    else if (!group.interpretation.includes(interp)) {
      group.interpretation = `${group.interpretation}\n\n${interp}`;
    }
  };

  for (const x of raw) {
    const dept = clean(x.deptName) ?? 'OTHER';
    const type = (x.testtype ?? '').trim();
    if (x.testcode) codes.add(x.testcode.trim().toUpperCase());
    const spec = clean(x.specimen);
    if (spec) specimens.add(spec);

    // Does this row belong to the open panel? Membership is by shared
    // profile_id within the same department.
    const inPanel =
      panel != null &&
      x.profileId != null &&
      x.profileId === panel.pid &&
      panel.dept === dept;

    // A 'Profile' row opens a new panel; its child rows (same profile_id) follow.
    if (type === 'Profile') {
      head = null;
      const item: SampleReportItem = {
        kind: 'panel',
        panel: { profileId: x.profileId ?? null, title: clean(x.testname), children: [] },
      };
      panel = { dept, pid: x.profileId ?? -1, item };
      pushItem(dept, item);
      continue;
    }

    // A 'Head' is a multi-parameter test: child of the open panel when its
    // profile_id matches, else a standalone top-level group. Its 'Param' rows
    // (same testid) follow.
    if (type === 'Head') {
      // A Has_Parameters test emits an empty-testcode "report name" Head
      // immediately followed by the real coded Head that the Param rows hang off
      // — e.g. TB Gene Xpert. Collapse the empty Head into the next one so the
      // title and interpretation aren't printed twice. BUT only when the test has
      // a single coded Head: a profile with MULTIPLE coded Heads (CBC) keeps each
      // sub-group's own name, so don't collapse those.
      if (
        head &&
        head.tid === x.testid &&
        x.testid != null &&
        head.group.rows.length === 0 &&
        (codedHeadCount.get(x.testid) ?? 0) <= 1
      ) {
        continue;
      }
      const group: SampleReportGroup = {
        // The result row already carries the right title: the empty-code Head's
        // name IS the report name (kept for single-Head tests like TB via the
        // collapse above), and each coded Head carries its real sub-group name
        // (Automated 5 Part Analyzer, Differential Counts %, …). ReportTestname
        // is NOT used — it's the parent's name and would clobber sub-groups.
        title: clean(x.testname),
        testId: x.testid,
        method: clean(x.method),
        interpretation: cleanMultiline(x.interpretation),
        rows: [],
      };
      if (x.testid != null) {
        imageHosts.push({ testId: x.testid, set: (u) => (group.interpretationImageDataUrl = u) });
      }
      if (inPanel) {
        panel!.item.panel!.children.push({ kind: 'group', group });
      } else {
        panel = null;
        pushItem(dept, { kind: 'group', group });
      }
      head = { tid: x.testid, group };
      continue;
    }

    if (type === 'Param' && head) {
      head.group.rows.push(toRow(x));
      addInterp(head.group, cleanMultiline(x.interpretation));
      const hadCulture = head.group.culture != null;
      applyCultureField(head.group, x);
      if (!hadCulture && head.group.culture) cultureGroups.push(head.group);
      continue;
    }

    // A 'Test' is a single-result test: child of the open panel when its
    // profile_id matches, else standalone. Either way it closes any open Head.
    if (type === 'Test') {
      head = null;
      const block: SampleReportBlock = {
        kind: 'single',
        row: toRow(x),
        testId: x.testid,
        interpretation: cleanMultiline(x.interpretation),
      };
      if (inPanel) {
        if (x.testid != null) {
          imageHosts.push({
            testId: x.testid,
            set: (u) => (block.interpretationImageDataUrl = u),
          });
        }
        panel!.item.panel!.children.push(block);
      } else {
        panel = null;
        const item: SampleReportItem = {
          kind: 'single',
          row: block.row,
          testId: x.testid,
          interpretation: block.interpretation,
        };
        if (x.testid != null) {
          imageHosts.push({ testId: x.testid, set: (u) => (item.interpretationImageDataUrl = u) });
        }
        pushItem(dept, item);
      }
      continue;
    }

    // Orphan Param or any unexpected type — render as a standalone single.
    head = null;
    panel = null;
    pushItem(dept, {
      kind: 'single',
      row: toRow(x),
      testId: x.testid,
      interpretation: cleanMultiline(x.interpretation),
    });
  }

  // Drop the structured antibiogram from any group that matched a C&S field
  // (e.g. "Remarks") but lacks the real signature, so it falls back to the
  // normal parameter-row rendering.
  for (const g of cultureGroups) {
    if (!g.culture) continue;
    if (!hasAntibiogram(g.culture)) {
      delete g.culture;
      continue;
    }
    dedupeAntibiogram(g.culture);
  }

  // Fetch interpretation image attachments for the (few) tests in this report
  // that have one, and inline them as data-URIs on their group / single block.
  const imageTestIds = [...new Set(imageHosts.map((h) => h.testId))];
  if (imageTestIds.length) {
    try {
      const imgMap = await withRetry(async () => {
        const pool = await getPool();
        const req = pool.request();
        const params = imageTestIds.map((id, i) => {
          req.input(`t${i}`, sql.Int, id);
          return `@t${i}`;
        });
        const r = await req.query<{ testid: number; attachment: Buffer | null }>(`
          SELECT testid, attachment
          FROM dbo.tbl_med_test_master_attachment
          WHERE testid IN (${params.join(',')})
        `);
        const m = new Map<number, string>();
        for (const row of r.recordset) {
          if (!row.attachment || row.attachment.length === 0) continue;
          // Sniff the magic bytes; the LIS stores these as PNG (or JPEG).
          const sig = row.attachment.subarray(0, 3).toString('hex');
          const mime = sig === 'ffd8ff' ? 'image/jpeg' : 'image/png';
          m.set(row.testid, `data:${mime};base64,${row.attachment.toString('base64')}`);
        }
        return m;
      });
      for (const h of imageHosts) {
        const url = imgMap.get(h.testId);
        if (url) h.set(url);
      }
    } catch {
      // Image attachments are best-effort; a failure must not break the report.
    }
  }

  const departments: SampleReportDepartment[] = deptOrder.map((name) => ({
    name,
    items: deptItems.get(name)!,
  }));

  return { departments, codes: [...codes], specimens: [...specimens] };
}
