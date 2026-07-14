'use server';

import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getWorksheetReports } from '@/lib/listec';
import type { WorksheetReportRow } from '@/lib/listec.types';
import { loadCatalog, filterCatalog } from '@/db/read/catalog';
import {
  reportClientCodeScope,
  filterRowsByReportScope,
} from '@/lib/reportScope';
import { computeReportLocks } from '@/lib/reportLock';

export interface ReportSearchFilters {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  /** Test/profile code to narrow the SID search by (''/undefined = any). */
  testCode?: string;
  clientCode?: string;
  businessUnit?: string;
  /** Exact status name to keep (from the LIS status lookups); '' = any. */
  status?: string;
  /** Universal query — patient name, SID, PID, test name/code, etc. */
  q?: string;
}

/** One row in the Reporting results table (one sample). */
export interface ReportSearchRow {
  sid: string;
  pid: number;
  patientName: string | null;
  ageGender: string;
  clientCode: string | null;
  businessUnit: string | null;
  collectedAt: string | null;
  reportedAt: string | null;
  status: string | null;
  /** Headline value for the filtered test (null when filter = all tests). */
  value: string | null;
  unit: string | null;
  abnormal: boolean;
  /** Comma-separated list of tests on the sample (shown when no single value). */
  testNames: string | null;
  /** YYYY-MM-DD of the sample — lets the report fragment query a tight window. */
  dateHint: string | null;
  /** True when the sample's report is finalised (every result authorised) and
   *  therefore safe to bulk-download. Drives the Reporting multi-select gate —
   *  in-progress samples (e.g. "Sample Registered") are not selectable. */
  ready: boolean;
  /** Balance lock (Telo-only): true when the report cannot be viewed/printed
   *  because of an outstanding balance — the patient's own bill (B2C) or the
   *  client's wallet (B2B). See lib/reportLock.ts. */
  locked: boolean;
  /** Which balance triggered the lock ('patient' | 'client'), or null. */
  lockReason: 'patient' | 'client' | null;
  /** The outstanding amount (₹) behind the lock, for the message. */
  dueAmount: number;
}

/** A test/profile option for the Reporting test-filter picker. */
export interface ReportTestOption {
  id: number;
  code: string;
  name: string | null;
}

/** YYYY-MM-DD from a date-ish string, or null. */
function ymdFrom(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function ageGenderLabel(
  age: number | null,
  unit: string | null,
  sex: string | null,
): string {
  const a = age == null ? '—' : `${age}${unit ? ' ' + unit : ''}`;
  const g = sex ? sex.trim() : '—';
  return `${a} / ${g}`;
}

/** Map a worksheet row → result row; resolve the anchor test's headline value. */
function mapRow(r: WorksheetReportRow, anchor: string): ReportSearchRow {
  let value: string | null = null;
  let unit: string | null = null;
  let abnormal = false;
  if (anchor) {
    const t = r.results.find(
      (x) => (x.test_code ?? '').trim().toUpperCase() === anchor,
    );
    if (t) {
      value = t.value;
      unit = t.unit;
      abnormal = t.abnormal;
    }
  }
  return {
    sid: r.sid,
    pid: r.pid,
    patientName: r.patient_name,
    ageGender: ageGenderLabel(r.age, r.age_unit, r.sex),
    clientCode: r.client_code,
    businessUnit: r.business_unit,
    collectedAt: r.sample_drawn,
    reportedAt: r.last_modified_at,
    status: r.status,
    value,
    unit,
    abnormal,
    testNames: r.test_names_csv,
    // Anchor for the report fragment's tight worksheet window. It MUST track the
    // column the worksheet SP filters on — `S.modifieddate` (surfaced as
    // `regd_at`) — not the sample-draw time. For a same-day sample the two
    // coincide, but a delayed/rechecked report has its modifieddate bumped days
    // after the draw; anchoring on sample_drawn then builds a ±window that never
    // contains modifieddate, so the fragment's SP fetch returns nothing and the
    // preview/PDF 404s. Prefer regd_at; fall back only if it's absent.
    dateHint:
      ymdFrom(r.regd_at) ??
      ymdFrom(r.last_modified_at) ??
      ymdFrom(r.sample_drawn),
    ready: r.results.length > 0 && r.results.every((t) => t.authorized),
    // Defaults; searchReports fills these in via computeReportLocks().
    locked: false,
    lockReason: null,
    dueAmount: 0,
  };
}

/**
 * Cluster rows so every patient's samples are contiguous — a lab tech sees all
 * of one PID's reports together (e.g. all three VINTI rows in a row). Stable
 * group-by: groups appear in each PID's first-seen order, and rows keep their
 * incoming order within a group, so the underlying reported-time ordering is
 * preserved as much as grouping allows.
 */
function groupByPid(rows: ReportSearchRow[]): ReportSearchRow[] {
  const groups = new Map<number, ReportSearchRow[]>();
  const order: number[] = [];
  for (const r of rows) {
    let g = groups.get(r.pid);
    if (!g) {
      g = [];
      groups.set(r.pid, g);
      order.push(r.pid);
    }
    g.push(r);
  }
  return order.flatMap((pid) => groups.get(pid) ?? []);
}

/** Stamp each result row with its balance lock (patient bill / client wallet). */
async function annotateLocks(rows: ReportSearchRow[]): Promise<ReportSearchRow[]> {
  if (rows.length === 0) return rows;
  const locks = await computeReportLocks(
    rows.map((r) => ({ sid: r.sid, pid: r.pid, clientCode: r.clientCode })),
  );
  for (const r of rows) {
    const l = locks.get(r.sid);
    if (l) {
      r.locked = l.locked;
      r.lockReason = l.reason;
      r.dueAmount = l.dueAmount;
    }
  }
  return rows;
}

/** Does the worksheet row match the universal query (case-insensitive)? */
function rowMatchesQuery(r: WorksheetReportRow, qLower: string): boolean {
  const hay: (string | null | undefined)[] = [
    r.patient_name,
    r.sid,
    String(r.pid ?? ''),
    r.client_code,
    r.business_unit,
    r.test_names_csv,
    r.bill_number,
  ];
  for (const h of hay) {
    if (h && h.toLowerCase().includes(qLower)) return true;
  }
  for (const t of r.results) {
    if (
      (t.test_code ?? '').toLowerCase().includes(qLower) ||
      (t.test_name ?? '').toLowerCase().includes(qLower)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Search samples for the Reporting tab. Gated to `report:view`. The optional
 * `testCode` narrows to samples carrying that test/profile (and surfaces the
 * test's headline value); `q` is a universal search — routed server-side
 * (digits → SID/bill#, text → patient name/MRN AND test name/code) plus
 * matched across the loaded date-range window (patient/SID/PID/client/BU/test
 * name+code). The generated report always shows the full sample — this only
 * finds the SID.
 */
export async function searchReports(
  filters: ReportSearchFilters,
): Promise<ReportSearchRow[]> {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'report:view')) {
    throw new Error('Not authorised to view reports.');
  }

  const anchor = (filters.testCode ?? '').trim().toUpperCase();
  const q = (filters.q ?? '').trim();
  const statusSel = (filters.status ?? '').trim().toLowerCase();
  const passesStatus = (row: ReportSearchRow) =>
    !statusSel || (row.status ?? '').trim().toLowerCase() === statusSel;

  // A report (or partial report) can only be released once results are
  // authorised. Show ONLY samples whose LIS status indicates authorisation or
  // printing has happened — AUTHORIZED, PARTIALLY AUTHORIZED, PRINTED, PARTIALLY
  // PRINTED. Everything pre-authorisation (SAMPLE REGISTERED, SAMPLE SENT,
  // PARTIALLY TESTED, TESTED, PENDING, REJECTED) is hidden.
  //
  // NB: do NOT gate on per-result `authorized` — every profile's Head/title row
  // carries auth=true even on a wholly-untested sample, so `results.some(
  // authorized)` is true for almost everything. The sample STATUS is the
  // reliable releasable signal.
  //
  // TODO(pre-prod, ~next week): a PARTIALLY-authorised/printed sample's generated
  // PDF still includes its not-yet-authorised tests — getSampleReport() returns
  // all result rows. Exclude unauthorised tests from the report before prod. See
  // the detailed note above getSampleReport in db/read/sampleReport.ts.
  const isReleasable = (r: WorksheetReportRow) =>
    /(authoriz|authoris|print)/i.test(r.status ?? '');

  // Per-client report scope: null = unrestricted (super_admin/admin); otherwise
  // only the user's own client code(s). Applied to every fetched row so a
  // client-facing role (client_reporting) never sees another client's reports.
  const scopeCodes = await reportClientCodeScope(user);

  // Which clientCode(s) to push to the SERVER query. For a client-scoped role
  // (client_reporting) we ALWAYS pin to their own code(s): the worksheet fetch
  // is page-capped, so a null clientCode returns a global page in which one
  // client's reports can be crowded out entirely by other clients — post-
  // filtering that page then yields nothing (the "no reports" bug). If they
  // typed a code within their scope, honour just that one. Unrestricted roles
  // (super_admin/admin) keep the single, optionally-null fetch.
  const typedCode = filters.clientCode?.trim() || null;
  let queryCodes: (string | null)[];
  if (scopeCodes) {
    if (scopeCodes.size === 0) return []; // scoped to no client → nothing to show
    queryCodes =
      typedCode && scopeCodes.has(typedCode.toUpperCase())
        ? [typedCode]
        : [...scopeCodes];
  } else {
    queryCodes = [typedCode];
  }

  const baseFilters = {
    fromDate: filters.from,
    toDate: filters.to,
    businessUnit: filters.businessUnit?.trim() || null,
    testCode: anchor || null,
  };
  // Fetch once per in-scope clientCode (usually exactly one) and flatten.
  const fetchScoped = (
    extra: Partial<Parameters<typeof getWorksheetReports>[0]>,
  ) =>
    Promise.all(
      queryCodes.map((cc) =>
        getWorksheetReports({ ...baseFilters, clientCode: cc, ...extra }),
      ),
    ).then((batches) => batches.flat());

  // No universal query → plain date-range list (today's behaviour).
  if (!q) {
    const rows = filterRowsByReportScope(
      await fetchScoped({ pageSize: 500 }),
      scopeCodes,
    );
    return annotateLocks(
      groupByPid(
        rows
          .filter(isReleasable)
          .map((r) => mapRow(r, anchor))
          .filter(passesStatus),
      ),
    );
  }

  const numeric = /^\d+$/.test(q);
  const qLower = q.toLowerCase();

  // (a) Precise, unbounded server fetches routed by query shape. A text query
  //     is routed BOTH as a patient-name match AND as a server-side test
  //     filter (the SP's @test_code matches S.testcodes and result test
  //     names), so a test-name search like "double" finds every matching
  //     sample in the date range — not just those inside the page-capped
  //     window fetch below. Skipped when the dedicated test filter (anchor)
  //     is set, since both ride the same @test_code parameter.
  const routedPromises = [
    fetchScoped(
      numeric ? { sid: q, pageSize: 500 } : { patientName: q, pageSize: 500 },
    ),
  ];
  if (!numeric && !anchor) {
    routedPromises.push(fetchScoped({ testCode: q, pageSize: 500 }));
  }
  // (b) Broad date-range window, filtered in-process across every field so
  //     PID / client / bill# also match (bounded to this window).
  const windowPromise = fetchScoped({ pageSize: 1000 });

  const [routedRaw, windowRaw] = await Promise.all([
    Promise.all(routedPromises).then((batches) => batches.flat()),
    windowPromise,
  ]);
  const routed = filterRowsByReportScope(routedRaw, scopeCodes);
  const windowRows = filterRowsByReportScope(windowRaw, scopeCodes);

  // Union by sid; routed (precise) first, then window cross-field matches.
  const bySid = new Map<string, ReportSearchRow>();
  for (const r of routed) {
    if (!isReleasable(r)) continue;
    if (!bySid.has(r.sid)) bySid.set(r.sid, mapRow(r, anchor));
  }
  for (const r of windowRows) {
    if (bySid.has(r.sid)) continue;
    if (!isReleasable(r)) continue;
    if (rowMatchesQuery(r, qLower)) bySid.set(r.sid, mapRow(r, anchor));
  }

  return annotateLocks(
    groupByPid(Array.from(bySid.values()).filter(passesStatus).slice(0, 500)),
  );
}

/**
 * Type-ahead over the test + profile catalog for the Reporting test filter.
 * Gated to `report:view` (the catalog isn't client data, so it needs no
 * per-client scoping). Returns up to 30 matches; profiles/masters are suffixed
 * so they read distinctly in the list.
 */
export async function searchReportTests(q: string): Promise<ReportTestOption[]> {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'report:view')) return [];
  const all = await loadCatalog();
  return filterCatalog(all, q, 'all', 30).map((i) => ({
    id: i.id,
    code: i.code,
    name: i.kind === 'test' ? i.name : `${i.name} · ${i.kind}`,
  }));
}
