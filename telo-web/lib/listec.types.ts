/**
 * Types aligned with Noble.dbo.usp_listec_worksheet_report_json, mirrored from
 * the Listec integration (`Listec/integration/node-mssql/listec.types.ts`).
 * Kept as a local copy so telo-web doesn't import across the workspace
 * boundary — the Listec container is the runtime source of this data, served
 * over /api/worksheet-reports and proxied in lib/listec.ts.
 */

/** Query parameters accepted by the /api/worksheet-reports proxy endpoint. */
export interface WorksheetReportFilters {
  fromDate: string; // 'YYYY-MM-DD'
  toDate: string;
  fromHour?: number; // 0..23
  toHour?: number; // 1..24
  patientName?: string | null;
  statusId?: number | null;
  /** Partial match on MCCUnitCode (the "client code"). */
  clientCode?: string | null;
  /** Business unit name — resolved to an id server-side. */
  businessUnit?: string | null;
  businessUnitId?: number | null;
  sid?: string | null;
  departmentId?: number | null;
  testCode?: string | null;
  pid?: number | null;
  includeUnauthorized?: boolean;
  page?: number;
  pageSize?: number;
}

/** One element inside a row's `results` array. */
export interface TestResult {
  result_id: number;
  test_code: string | null;
  test_name: string | null;
  test_type: string | null;
  value: string | null;
  unit: string | null;
  normal_range: string | null;
  abnormal: boolean;
  authorized: boolean;
  comments: string | null;
  updated_at: string | null;
  department_code: string | null;
  department_name: string | null;
}

/** One worksheet row (one sample / SID) with its nested results. */
export interface WorksheetReportRow {
  client_code: string | null;
  business_unit: string | null;
  pid: number;
  patient_name: string | null;
  sex: string | null;
  age: number | null;
  age_unit: string | null;
  sid: string;
  sample_drawn: string | null;
  regd_at: string | null;
  last_modified_at: string | null;
  status_code: number | null;
  status: string | null;
  test_names_csv: string | null;
  order_number: string | null;
  bill_number: string | null;
  sample_comments: string | null;
  clinical_history: string | null;
  tat: string | null;
  results: TestResult[];
}

/** Envelope returned by GET /api/worksheet-reports. */
export interface WorksheetReportResponse {
  count: number;
  data: WorksheetReportRow[];
  resolved?: unknown;
  unresolved?: string[];
}
