import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getWorksheetReports } from '@/lib/listec';
import {
  resolveBusinessUnit,
  getSignersForBusinessUnit,
} from '@/db/read/signatures';
import { getReferringDoctor } from '@/db/read/refDoctor';
import { getMccCentreByCode } from '@/db/read/mccUnits';
import { getProfileInterpretations } from '@/db/read/profileInterpretations';
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
  searchParams: Promise<{ pdf?: string; date?: string; split?: string; exclude?: string }>;
}) {
  const { sid } = await params;
  const sp = await searchParams;
  const pdfMode = sp.pdf === '1' || sp.pdf === 'true';
  const splitByDepartment = sp.split === '1' || sp.split === 'true';

  // Tests the user unticked in the preview. Keys are "deptIndex:itemIndex" for a
  // top-level item, or "deptIndex:itemIndex:childIndex" for a panel child. Only
  // honoured by the PDF render; the preview manages selection client-side.
  const excludedKeys = (sp.exclude ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+:\d+(?::\d+)?$/.test(s));

  const user = await requireSession();
  if (!hasCapability(user.caps, 'report:view')) notFound();

  const decodedSid = decodeURIComponent(sid).trim();
  if (!decodedSid) notFound();

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

  const [report, bu, refDoctor, collectionCentre, profileInterpretations] =
    await Promise.all([
      getSampleReport(decodedSid, row.age, row.age_unit),
      resolveBusinessUnit(row.business_unit),
      getReferringDoctor(row.pid),
      getMccCentreByCode(row.client_code),
      getProfileInterpretations(),
    ]);

  // All configured signatories, ordered primary → secondary (DOC_TYPE asc),
  // capped at three so the footer never overflows the page width.
  const rawSigners = bu ? await getSignersForBusinessUnit(bu.id) : [];
  const signers = [...rawSigners]
    .sort((a, b) => (a.docType ?? 99) - (b.docType ?? 99))
    .slice(0, 3);

  const data: LabReportData = {
    pdf: pdfMode,
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
    departments: report.departments,
    processedAt: bu
      ? { name: bu.name, address: bu.address, city: bu.city, phone: bu.phone }
      : null,
    signers: signers.map((s) => ({
      id: s.id,
      doctorName: s.doctorName,
      designation: s.designation,
    })),
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
