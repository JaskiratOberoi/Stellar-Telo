import 'server-only';
import { env } from '@/lib/env';
import { cached } from '@/lib/cache';
import type {
  WorksheetReportFilters,
  WorksheetReportResponse,
  WorksheetReportRow,
} from '@/lib/listec.types';

/**
 * Typed client for the existing read-only Listec container. Reads we don't
 * want to re-implement (master lookups, MCC units + normalised geography)
 * are proxied here and redis-cached, rather than re-querying Noble.
 */
export interface ListecLookups {
  businessUnits: string[];
  statuses: string[];
  departments: string[];
}

export interface MccUnit {
  code: string;
  name: string | null;
  businessUnitCode: string | null;
  cityLabel: string;
  stateLabel: string;
  rateLabel: string | null;
}

async function listecGet<T>(pathname: string): Promise<T> {
  const url = `${env().LISTEC_API_BASE_URL}${pathname}`;
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    // Listec is internal; never cache at the fetch layer — we cache in redis.
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Listec ${pathname} -> HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function getLookups(): Promise<ListecLookups> {
  return cached('telo:listec:lookups', 900, () =>
    listecGet<ListecLookups>('/api/lookups'),
  );
}

export async function getMccUnits(): Promise<MccUnit[]> {
  return cached('telo:listec:mcc-units', 900, async () => {
    const raw = await listecGet<{ rows: MccUnit[] }>('/api/mcc-units');
    return raw.rows ?? [];
  });
}

/**
 * Live worksheet results via the Listec container's
 * `GET /api/worksheet-reports` (which wraps usp_listec_worksheet_report_json).
 * Powers the Reporting tab. NOT redis-cached — these are fresh result rows,
 * and the filter space is wide; the SP itself is the cache-of-record. Optional
 * filters are omitted from the query string (the endpoint treats absent params
 * as "no filter"), so only set ones the caller provided are forwarded.
 */
export async function getWorksheetReports(
  f: WorksheetReportFilters,
): Promise<WorksheetReportRow[]> {
  const qs = new URLSearchParams();
  qs.set('fromDate', f.fromDate);
  qs.set('toDate', f.toDate);
  const put = (k: string, v: string | number | boolean | null | undefined) => {
    if (v === null || v === undefined || v === '') return;
    qs.set(k, String(v));
  };
  put('fromHour', f.fromHour);
  put('toHour', f.toHour);
  put('patientName', f.patientName);
  put('statusId', f.statusId);
  put('clientCode', f.clientCode);
  put('businessUnit', f.businessUnit);
  put('businessUnitId', f.businessUnitId);
  put('sid', f.sid);
  put('departmentId', f.departmentId);
  put('testCode', f.testCode);
  put('pid', f.pid);
  put('includeUnauthorized', f.includeUnauthorized);
  put('page', f.page);
  put('pageSize', f.pageSize);

  const res = await listecGet<WorksheetReportResponse>(
    `/api/worksheet-reports?${qs.toString()}`,
  );
  return res.data ?? [];
}
