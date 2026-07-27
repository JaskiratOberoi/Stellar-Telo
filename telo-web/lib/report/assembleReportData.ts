import 'server-only';
import { getSampleHeader } from '@/db/read/sampleHeader';
import {
  resolveBusinessUnit,
  getSignersForBusinessUnit,
  getDepartmentSignerMap,
  getSignatureBytes,
  getDefaultSigners,
} from '@/db/read/signatures';
import { getReferringDoctor } from '@/db/read/refDoctor';
import { getMccCentreByCode } from '@/db/read/mccUnits';
import { getProfileInterpretations } from '@/db/read/profileInterpretations';
import { reportQrDataUrl } from '@/lib/report/reportLink';
import { getSampleReport } from '@/db/read/sampleReport';
import type { LabReportData } from '@/components/reporting/tsh-report';

/** YYYY-MM-DD for `d`. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export interface AssembleReportOptions {
  sid: string;
  pdf: boolean;
  headless: boolean;
  splitByDepartment: boolean;
  excludedKeys: string[];
  /** 'YYYY-MM-DD' date hint to tighten the worksheet window, or null. */
  dateHint: string | null;
}

/**
 * Assembles the full LabReportData for one sample (SID) — the worksheet header,
 * grouped results, collection centre, referring doctor, and department-aware
 * signatories. Shared by BOTH report formats (the default clinical report and
 * the patient-friendly Smart Report) so they always draw the same underlying
 * data. Callers own auth + balance-lock gating; this does data only.
 *
 * Returns null when no worksheet row exists for the SID.
 */
export async function assembleLabReportData(
  opts: AssembleReportOptions,
): Promise<LabReportData | null> {
  const decodedSid = opts.sid.trim();
  if (!decodedSid) return null;

  // Header/demographics via ONE exact-match read (the fast path shared with the
  // default report — see db/read/sampleHeader.ts). This replaced the worksheet
  // SP's wide-window LIKE scans.
  const row = await getSampleHeader(decodedSid);
  if (!row) return null;

  // Date hint for the public QR link (tightens the worksheet window on scan).
  const qrDate =
    opts.dateHint && /^\d{4}-\d{2}-\d{2}$/.test(opts.dateHint)
      ? opts.dateHint
      : row.sample_drawn && !Number.isNaN(new Date(row.sample_drawn).getTime())
        ? ymd(new Date(row.sample_drawn))
        : null;

  const [report, bu, refDoctor, collectionCentre, profileInterpretations, qrDataUrl] =
    await Promise.all([
      getSampleReport(decodedSid, row.age, row.age_unit),
      resolveBusinessUnit(row.business_unit),
      getReferringDoctor(row.pid),
      getMccCentreByCode(row.client_code),
      getProfileInterpretations(),
      reportQrDataUrl(decodedSid, qrDate),
    ]);

  // Configured signatories for the BU, made DEPARTMENT-AWARE (mirrors the LIS
  // Department_View_Sign export): a specialist mapped only to a specific
  // department — e.g. the Microbiology MD — prints only when the report
  // contains that department, not on every report. General / BU-specific
  // signatories (not tied to any department) always print.
  const rawSigners = bu ? await getSignersForBusinessUnit(bu.id) : [];
  const deptSignerMap = rawSigners.length ? await getDepartmentSignerMap() : new Map();
  const reportDepts = new Set(report.departments.map((d) => d.name.trim().toUpperCase()));
  const normName = (n: string | null) =>
    (n ?? '').toLowerCase().replace(/^dr\.?\s*/, '').replace(/[^a-z0-9]/g, '');
  const byName = new Map<string, (typeof rawSigners)[number]>();
  for (const s of rawSigners) {
    const k = normName(s.doctorName);
    const existing = byName.get(k);
    if (!existing) byName.set(k, s);
    else if (deptSignerMap.has(s.id) && !deptSignerMap.has(existing.id)) byName.set(k, s);
  }
  const deptFiltered = [...byName.values()].filter((s) => {
    const depts = deptSignerMap.get(s.id) as Set<string> | undefined;
    if (!depts || depts.size === 0) return true;
    for (const d of depts) if (reportDepts.has(d)) return true;
    return false;
  });
  const selectedSigners = deptFiltered.length ? deptFiltered : [...byName.values()];
  const orderedSigners = [...selectedSigners]
    .sort((a, b) => (a.docType ?? 99) - (b.docType ?? 99))
    .slice(0, 3);
  const configuredSigners = await Promise.all(
    orderedSigners.map(async (s) => {
      const sig = await getSignatureBytes(s.id);
      return {
        id: s.id,
        doctorName: s.doctorName,
        designation: s.designation,
        signatureDataUrl: sig
          ? `data:${sig.mime};base64,${sig.bytes.toString('base64')}`
          : null,
      };
    }),
  );
  const signers =
    configuredSigners.length > 0
      ? configuredSigners
      : await getDefaultSigners(report.departments.map((d) => d.name));

  return {
    pdf: opts.pdf,
    headless: opts.headless && !opts.pdf,
    splitByDepartment: opts.splitByDepartment,
    excludedKeys: opts.excludedKeys,
    patientName: row.patient_name,
    pid: row.pid,
    sid: row.sid,
    sex: row.sex,
    age: row.age,
    ageUnit: row.age_unit,
    clientCode: row.client_code,
    refDoctor,
    collectedAt: row.sample_drawn,
    registeredAt: row.regd_at,
    reportedAt: row.last_modified_at,
    statusLabel: row.status,
    billNumber: row.bill_number,
    clinicalHistory: row.clinical_history,
    specimens: report.specimens,
    collectionCentre,
    profileInterpretations,
    qrDataUrl,
    departments: report.departments,
    processedAt: bu
      ? { name: bu.name, address: bu.address, city: bu.city, phone: bu.phone }
      : null,
    signers,
    printedAt: new Date().toISOString(),
  };
}
