import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getWorksheetReports } from '@/lib/listec';
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
import { reportQrDataUrl, verifyReportToken } from '@/lib/report/reportLink';
import { canAccessSidReport } from '@/lib/reportScope';
import { isSidReportLocked } from '@/lib/reportLock';
import { getSampleReport } from '@/db/read/sampleReport';
import { LabReport, type LabReportData } from '@/components/reporting/tsh-report';

export const dynamic = 'force-dynamic';

/** YYYY-MM-DD for `d`. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Print fragment for one sample's full report, keyed by SID. Rendered (a) inside
 * the Reporting tab's preview iframe and (b) by headless Chromium for the
 * on-letterhead PDF (`?pdf=1`). The worksheet feed supplies the header/demographics;
 * the grouped results come from getSampleReport (direct, report-ordered).
 */
export default async function ReportingPrintFragment({
  params,
  searchParams,
}: {
  params: Promise<{ sid: string }>;
  searchParams: Promise<{
    pdf?: string;
    date?: string;
    split?: string;
    exclude?: string;
    token?: string;
    headless?: string;
  }>;
}) {
  const { sid } = await params;
  const sp = await searchParams;
  const pdfMode = sp.pdf === '1' || sp.pdf === 'true';
  const splitByDepartment = sp.split === '1' || sp.split === 'true';
  // Letterhead-paper preview: blank the Noble letterhead band so the preview
  // matches the headless PDF. Preview-only — the PDF route drops the letterhead
  // background itself, so this hint is ignored under ?pdf=1.
  const headless = sp.headless === '1' || sp.headless === 'true';

  // Tests the user unticked in the preview. Keys are "deptIndex:itemIndex" for a
  // top-level item, "deptIndex:itemIndex:childIndex" for a panel child, with an
  // optional trailing row index for an individual parameter inside a group. Only
  // honoured by the PDF render; the preview manages selection client-side.
  const excludedKeys = (sp.exclude ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+:\d+(?::\d+){0,2}$/.test(s));

  const decodedSid = decodeURIComponent(sid).trim();
  if (!decodedSid) notFound();

  // Two ways in: a logged-in user with report:view, OR a valid per-report token
  // (the public QR/softcopy path — no session). An invalid token falls through
  // to the session check, which 404s for the unauthenticated.
  const tokenOk = sp.token ? verifyReportToken(decodedSid, sp.token) : false;
  if (!tokenOk) {
    const user = await requireSession();
    if (!hasCapability(user.caps, 'report:view')) notFound();
    // Client-facing reporters (client_reporting) may only open their own
    // client's reports. Unrestricted roles pass through. (The token path is
    // pre-scoped: tokens are only minted by the PDF route for in-scope SIDs.)
    // Balance lock (Telo-only): don't render the report while there's an
    // outstanding balance. The token path is pre-gated by the PDF route.
    const [scopeOk, lock] = await Promise.all([
      canAccessSidReport(user, decodedSid),
      isSidReportLocked(decodedSid),
    ]);
    if (!scopeOk) notFound();
    if (lock.locked) {
      return (
        <div className="mx-auto max-w-md p-10 text-center text-sm text-muted-foreground">
          <p className="text-base font-semibold text-foreground">
            Report on hold
          </p>
          <p className="mt-2">
            This report can’t be viewed or printed in Telo because there’s an
            outstanding balance of ₹{lock.dueAmount.toLocaleString('en-IN')} on
            the {lock.reason === 'client' ? 'client account' : "patient’s bill"}.
            Please clear the balance to release the report.
          </p>
        </div>
      );
    }
  }

  // Tight worksheet window around the sample's date when known (the SP crawls
  // wide ranges); fall back to a broad window only if no hint.
  const hint = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? new Date(sp.date) : null;
  let fromDate = '2015-01-01';
  let toDate: string;
  if (hint && !Number.isNaN(hint.getTime())) {
    const lo = new Date(hint);
    lo.setDate(lo.getDate() - 3);
    const hi = new Date(hint);
    hi.setDate(hi.getDate() + 3);
    fromDate = ymd(lo);
    toDate = ymd(hi);
  } else {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    toDate = ymd(tomorrow);
  }

  const rows = await getWorksheetReports({
    fromDate,
    toDate,
    sid: decodedSid,
    pageSize: 5,
  });
  const row = rows.find((r) => r.sid === decodedSid) ?? rows[0];
  if (!row) notFound();

  // Date hint for the public QR link (tightens the worksheet window on scan).
  const qrDate =
    sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
      ? sp.date
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
  const reportDepts = new Set(
    report.departments.map((d) => d.name.trim().toUpperCase()),
  );
  // Collapse duplicate doctors (the LIS has e.g. two "Upinder Singh" rows),
  // preferring the id that carries the department mapping so its rules apply.
  const normName = (n: string | null) =>
    (n ?? '').toLowerCase().replace(/^dr\.?\s*/, '').replace(/[^a-z0-9]/g, '');
  const byName = new Map<string, (typeof rawSigners)[number]>();
  for (const s of rawSigners) {
    const k = normName(s.doctorName);
    const existing = byName.get(k);
    if (!existing) byName.set(k, s);
    else if (deptSignerMap.has(s.id) && !deptSignerMap.has(existing.id)) byName.set(k, s);
  }
  // Keep a signatory iff it is not department-managed (general/BU-specific) OR
  // one of its departments is present on this report.
  const deptFiltered = [...byName.values()].filter((s) => {
    const depts = deptSignerMap.get(s.id) as Set<string> | undefined;
    if (!depts || depts.size === 0) return true;
    for (const d of depts) if (reportDepts.has(d)) return true;
    return false;
  });
  // Guard: never leave a report unsigned — if the department filter removed
  // everyone, fall back to the deduped list.
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
  // When the report's business unit has no signatories of its own (e.g. MDCARE /
  // MEDICARE), fall back to the LIS default signatories for this report's
  // departments — exactly as GET_PATIENT_REPORT_VAIL_ID does via the
  // Department_View_Sign view. Keeps the doctor signs from going missing.
  const signers =
    configuredSigners.length > 0
      ? configuredSigners
      : await getDefaultSigners(report.departments.map((d) => d.name));

  const data: LabReportData = {
    pdf: pdfMode,
    headless: headless && !pdfMode,
    splitByDepartment,
    excludedKeys,
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

  return (
    <>
      {/* PDF mode: apply letterhead-safe @page margins so EVERY printed page
          (not just the first/last) keeps a clear zone away from the letterhead
          header and footer, and force a transparent page background so the
          letterhead shows through. @page margins (unlike container padding)
          repeat on continuation pages — this is what prevents content from
          overlapping the letterhead on multi-page reports. */}
      {pdfMode && (
        <style>
          {
            '@page{size:A4 portrait;margin:26mm 14mm 34mm 14mm}@media print{html,body{background:transparent !important;background-color:transparent !important}}'
          }
        </style>
      )}
      <LabReport data={data} />
    </>
  );
}
