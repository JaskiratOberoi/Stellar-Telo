import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { verifyReportToken } from '@/lib/report/reportLink';
import { canAccessSidReport } from '@/lib/reportScope';
import { isSidReportLocked } from '@/lib/reportLock';
import { SmartReport } from '@/components/reporting/smart-report';
import { assembleLabReportData } from '@/lib/report/assembleReportData';

export const dynamic = 'force-dynamic';

/**
 * Print fragment for one sample's patient-friendly Smart Report, keyed by SID.
 * Same data + same auth gates as the default report fragment
 * (../page.tsx), but rendered with the wellness-styled SmartReport component.
 * Rendered (a) inside the Reporting tab's preview iframe and (b) by headless
 * Chromium for the PDF (`?pdf=1`). Unlike the default report, the Smart Report
 * draws its own branded header/footer and is printed without the Noble
 * letterhead, so it needs only modest @page margins.
 */
export default async function SmartReportingPrintFragment({
  params,
  searchParams,
}: {
  params: Promise<{ sid: string }>;
  searchParams: Promise<{ pdf?: string; date?: string; token?: string }>;
}) {
  const { sid } = await params;
  const sp = await searchParams;
  const pdfMode = sp.pdf === '1' || sp.pdf === 'true';

  const decodedSid = decodeURIComponent(sid).trim();
  if (!decodedSid) notFound();

  // Two ways in: a logged-in user with report:view, OR a valid per-report token
  // (the public softcopy path — no session). Mirrors the default fragment.
  const tokenOk = sp.token ? verifyReportToken(decodedSid, sp.token) : false;
  if (!tokenOk) {
    const user = await requireSession();
    if (!hasCapability(user.caps, 'report:view')) notFound();
    if (!(await canAccessSidReport(user, decodedSid))) notFound();
    const lock = await isSidReportLocked(decodedSid);
    if (lock.locked) {
      return (
        <div className="mx-auto max-w-md p-10 text-center text-sm text-muted-foreground">
          <p className="text-base font-semibold text-foreground">Report on hold</p>
          <p className="mt-2">
            This report can’t be viewed or printed in Telo because there’s an outstanding
            balance of ₹{lock.dueAmount.toLocaleString('en-IN')} on the{' '}
            {lock.reason === 'client' ? 'client account' : "patient’s bill"}. Please clear the
            balance to release the report.
          </p>
        </div>
      );
    }
  }

  const data = await assembleLabReportData({
    sid: decodedSid,
    pdf: pdfMode,
    headless: false,
    splitByDepartment: false,
    excludedKeys: [],
    dateHint: sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : null,
  });
  if (!data) notFound();

  return (
    <>
      {pdfMode && (
        <style>
          {
            // Content pages get comfortable margins; the first page (the cover)
            // is full-bleed so its gradient/art reaches every edge.
            '@page{size:A4 portrait;margin:13mm 12mm 15mm 12mm}@page:first{margin:0}@media print{html,body{background:#fff !important}}'
          }
        </style>
      )}
      <SmartReport data={data} />
    </>
  );
}
