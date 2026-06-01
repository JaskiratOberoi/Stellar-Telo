'use server';

import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getWorksheetReports } from '@/lib/listec';
import { getFilter } from '@/lib/report/panels';

export interface ReportSearchFilters {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  /** Test-filter id (see lib/report/panels.ts); 'all' = any test. */
  panel?: string;
  clientCode?: string;
  businessUnit?: string;
  sid?: string;
  pid?: string;
  patientName?: string;
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

/**
 * Search samples for the Reporting tab. Gated to `report:view` (super admin
 * only today). The selected filter optionally narrows by a representative test
 * code; 'all' returns every sample in range. The generated report always shows
 * the full sample — this only finds the SID.
 */
export async function searchReports(
  filters: ReportSearchFilters,
): Promise<ReportSearchRow[]> {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'report:view')) {
    throw new Error('Not authorised to view reports.');
  }

  const filter = getFilter(filters.panel);
  const anchor = filter.testCode.trim().toUpperCase();

  const pidNum =
    filters.pid && /^\d+$/.test(filters.pid.trim())
      ? Number(filters.pid.trim())
      : null;

  const rows = await getWorksheetReports({
    fromDate: filters.from,
    toDate: filters.to,
    clientCode: filters.clientCode?.trim() || null,
    businessUnit: filters.businessUnit?.trim() || null,
    sid: filters.sid?.trim() || null,
    pid: pidNum,
    patientName: filters.patientName?.trim() || null,
    testCode: anchor || null,
    pageSize: 500,
  });

  const out: ReportSearchRow[] = [];
  for (const r of rows) {
    // When a specific test is filtered, surface its value; only keep samples
    // that actually carry it. When 'all', show the sample's test list instead.
    let value: string | null = null;
    let unit: string | null = null;
    let abnormal = false;
    if (anchor) {
      const t = r.results.find(
        (x) => (x.test_code ?? '').trim().toUpperCase() === anchor,
      );
      if (!t) continue;
      value = t.value;
      unit = t.unit;
      abnormal = t.abnormal;
    }
    out.push({
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
      dateHint:
        ymdFrom(r.sample_drawn) ??
        ymdFrom(r.last_modified_at) ??
        ymdFrom(r.regd_at),
    });
  }
  return out;
}
