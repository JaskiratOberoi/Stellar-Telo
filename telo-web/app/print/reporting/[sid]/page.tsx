import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getWorksheetReports } from '@/lib/listec';
import { getTestMeta } from '@/db/read/testMeta';
import { getAgeSpecificRange } from '@/db/read/ageRange';
import {
  resolveBusinessUnit,
  getSignersForBusinessUnit,
} from '@/db/read/signatures';
import { getReferringDoctor } from '@/db/read/refDoctor';
import { getPanel } from '@/lib/report/panels';
import {
  TshReport,
  type TshReportData,
  type TshReportResult,
} from '@/components/reporting/tsh-report';

export const dynamic = 'force-dynamic';

/** YYYY-MM-DD for `d`. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Print fragment for a single report, keyed by SID + panel. Rendered (a) inside
 * the Reporting tab's preview iframe and (b) by headless Chromium for the
 * on-letterhead PDF (`?pdf=1`). SID is unique, so we query a wide date window.
 */
export default async function ReportingPrintFragment({
  params,
  searchParams,
}: {
  params: Promise<{ sid: string }>;
  searchParams: Promise<{ pdf?: string; panel?: string; date?: string }>;
}) {
  const { sid } = await params;
  const sp = await searchParams;
  const pdfMode = sp.pdf === '1' || sp.pdf === 'true';
  const panel = getPanel(sp.panel);

  const user = await requireSession();
  if (!hasCapability(user.caps, 'report:view')) notFound();

  const decodedSid = decodeURIComponent(sid).trim();
  if (!decodedSid) notFound();

  // Query a tight window around the sample's date when known (the worksheet SP
  // crawls over wide ranges); fall back to a broad window only if no hint.
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
    testCode: panel.anchorCode,
    pageSize: 5,
  });
  const row = rows.find((r) => r.sid === decodedSid) ?? rows[0];
  if (!row) notFound();

  // Per-code metadata (method + interpretation) for the panel's analytes.
  const metas = await Promise.all(panel.codes.map((c) => getTestMeta(c)));
  const metaByCode = new Map(
    panel.codes.map((c, i) => [c.toUpperCase(), metas[i]]),
  );

  // Analyte rows: each panel code present in the sample, in panel order. The
  // bio-ref range is resolved to the patient's age band when available
  // (falls back to the validated free-text range stored on the result).
  const results: TshReportResult[] = (
    await Promise.all(
      panel.codes.map(async (code): Promise<TshReportResult | null> => {
        const up = code.toUpperCase();
        const r = row.results.find(
          (x) => (x.test_code ?? '').trim().toUpperCase() === up,
        );
        if (!r) return null;
        const meta = metaByCode.get(up);
        const ageRange = meta
          ? await getAgeSpecificRange(meta.id, row.age, row.age_unit)
          : null;
        return {
          testName: r.test_name?.trim() || meta?.reportTestName || code,
          method: meta?.method ?? null,
          value: r.value,
          unit: r.unit,
          normalRange: ageRange ?? r.normal_range,
          abnormal: r.abnormal,
          comments: r.comments,
        };
      }),
    )
  ).filter((r): r is TshReportResult => r != null);

  // Section header from the sample's own Profile row (only for multi-analyte panels).
  const profileRow =
    panel.codes.length > 1
      ? row.results.find((x) => (x.test_type ?? '').toLowerCase() === 'profile')
      : undefined;
  const sectionTitle = profileRow?.test_name?.trim()
    ? profileRow.test_name.trim().toUpperCase()
    : null;

  const interpretation =
    metaByCode.get(panel.interpretationCode.toUpperCase())?.interpretation ?? null;

  const [bu, refDoctor] = await Promise.all([
    resolveBusinessUnit(row.business_unit),
    getReferringDoctor(row.pid),
  ]);
  // Single signatory: the primary pathologist (DOC_TYPE = 1), falling back to
  // the first available signer if none is flagged primary.
  const rawSigners = bu ? await getSignersForBusinessUnit(bu.id) : [];
  const pathologist =
    rawSigners.find((s) => s.docType === 1) ?? rawSigners[0] ?? null;
  const signers = pathologist ? [pathologist] : [];

  const data: TshReportData = {
    pdf: pdfMode,
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
    sectionTitle,
    results,
    meta: { interpretation },
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
      {/* In PDF mode: drop the global A4 margins so the component's own padding
          places content within the letterhead's clear zone, and force a
          transparent page background so the letterhead pdf-lib draws behind the
          content shows through (globals.css otherwise paints the body white in
          print, which would hide it). */}
      {pdfMode && (
        <style>
          {
            '@page{size:A4 portrait;margin:0}@media print{html,body{background:transparent !important;background-color:transparent !important}}'
          }
        </style>
      )}
      <TshReport data={data} />
    </>
  );
}
