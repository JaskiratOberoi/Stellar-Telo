/**
 * Report search filters + static report notes. No IO, so this is safe to import
 * from both the client filter dropdown and server code.
 *
 * The report itself always renders the FULL sample (all tests on the SID,
 * grouped by department) — so these "filters" only narrow the SID search by a
 * representative test code. `testCode: ''` means "any test".
 */
export interface ReportFilter {
  id: string;
  label: string;
  /** Worksheet test-code filter used to find candidate SIDs ('' = any). */
  testCode: string;
}

export const REPORT_FILTERS: ReportFilter[] = [
  { id: 'all', label: 'All tests', testCode: '' },
  { id: 'tsh', label: 'TSH / Thyroid', testCode: 'BI221' },
  { id: 'prolactin', label: 'Prolactin', testCode: 'BI180' },
];

export const DEFAULT_FILTER_ID = 'all';

export function getFilter(id: string | null | undefined): ReportFilter {
  return (
    REPORT_FILTERS.find((p) => p.id === id) ??
    REPORT_FILTERS.find((p) => p.id === DEFAULT_FILTER_ID) ??
    REPORT_FILTERS[0]
  );
}

/** Standard TSH notes (from the reference reports — not held in the LIS). */
const TSH_NOTES: string[] = [
  'TSH levels are subject to circadian variation, reaching peak levels between 2 - 4 a.m. and a minimum between 6 - 10 pm. The variation is of the order of 50%, hence time of the day has influence on the measured serum TSH concentrations.',
  'Values <0.03 µIU/mL need to be clinically correlated due to presence of a rare TSH variant in some individuals.',
  'Transient increase in TSH levels or abnormal TSH levels can be seen in various nonthyroidal diseases. Simultaneous measurement of TSH with free T4 is useful in evaluating the differential diagnosis.',
];

/**
 * Extra static "Note" lines shown for specific test codes when present on a
 * report. (Most note/interpretation text comes from the LIS itself; this is for
 * the few reference-only notes the LIS doesn't store, like the TSH notes.)
 */
export const STATIC_NOTES_BY_CODE: Record<string, string[]> = {
  BI221: TSH_NOTES,
};
