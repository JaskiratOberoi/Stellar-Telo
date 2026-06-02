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

export interface SampleReportGroup {
  /** Multi-parameter test title (e.g. "BILIRUBIN (TOTAL, DIRECT & INDIRECT)"). */
  title: string | null;
  method: string | null;
  interpretation: string | null;
  rows: SampleReportRow[];
}

/** A leaf block — a multi-parameter Head test, or a single standalone Test. It
 *  appears either at the top level of a department or as a panel's child. */
export interface SampleReportBlock {
  kind: 'group' | 'single';
  group?: SampleReportGroup;
  /** For a standalone test: the row plus its own interpretation. */
  row?: SampleReportRow;
  interpretation?: string | null;
}

/** A profile panel (e.g. "LIVER FUNCTION TEST") grouping several child blocks
 *  that share its profile_id. */
export interface SampleReportPanel {
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
  interpretation?: string | null;
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
    const stored = clean(x.normalRange);
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

  // Walk rows in report order, rebuilding groups, preserving department order.
  const deptOrder: string[] = [];
  const deptItems = new Map<string, SampleReportItem[]>();
  const codes = new Set<string>();
  const specimens = new Set<string>();

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
        panel: { title: clean(x.testname), children: [] },
      };
      panel = { dept, pid: x.profileId ?? -1, item };
      pushItem(dept, item);
      continue;
    }

    // A 'Head' is a multi-parameter test: child of the open panel when its
    // profile_id matches, else a standalone top-level group. Its 'Param' rows
    // (same testid) follow.
    if (type === 'Head') {
      const group: SampleReportGroup = {
        title: clean(x.testname),
        method: clean(x.method),
        interpretation: clean(x.interpretation),
        rows: [],
      };
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
      addInterp(head.group, clean(x.interpretation));
      continue;
    }

    // A 'Test' is a single-result test: child of the open panel when its
    // profile_id matches, else standalone. Either way it closes any open Head.
    if (type === 'Test') {
      head = null;
      const block: SampleReportBlock = {
        kind: 'single',
        row: toRow(x),
        interpretation: clean(x.interpretation),
      };
      if (inPanel) {
        panel!.item.panel!.children.push(block);
      } else {
        panel = null;
        pushItem(dept, { kind: 'single', row: block.row, interpretation: block.interpretation });
      }
      continue;
    }

    // Orphan Param or any unexpected type — render as a standalone single.
    head = null;
    panel = null;
    pushItem(dept, {
      kind: 'single',
      row: toRow(x),
      interpretation: clean(x.interpretation),
    });
  }

  const departments: SampleReportDepartment[] = deptOrder.map((name) => ({
    name,
    items: deptItems.get(name)!,
  }));

  return { departments, codes: [...codes], specimens: [...specimens] };
}
