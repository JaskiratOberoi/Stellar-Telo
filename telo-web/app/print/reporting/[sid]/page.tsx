import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { verifyReportToken } from '@/lib/report/reportLink';
import { canAccessSidReport } from '@/lib/reportScope';
import { isSidReportLocked } from '@/lib/reportLock';
import { LabReport } from '@/components/reporting/tsh-report';
import { assembleLabReportData } from '@/lib/report/assembleReportData';

export const dynamic = 'force-dynamic';

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
    if (!(await canAccessSidReport(user, decodedSid))) notFound();
    // Balance lock (Telo-only): don't render the report while there's an
    // outstanding balance. The token path is pre-gated by the PDF route.
    const lock = await isSidReportLocked(decodedSid);
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

  const data = await assembleLabReportData({
    sid: decodedSid,
    pdf: pdfMode,
    headless,
    splitByDepartment,
    excludedKeys,
    dateHint: sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : null,
  });
  if (!data) notFound();

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
