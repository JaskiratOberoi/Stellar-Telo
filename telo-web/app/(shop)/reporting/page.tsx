import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getLookups } from '@/lib/listec';
import { reportClientCodeScope } from '@/lib/reportScope';
import { ReportingView } from '@/components/reporting/reporting-view';

export const dynamic = 'force-dynamic';

/**
 * Reporting tab — customer-facing result reports. Gated by `report:view`
 * (super_admin / admin see all; `client_reporting` is scoped to their own
 * client code(s) via `lib/reportScope.ts`). Users filter for results, preview
 * the formatted report, and download it as a PDF on the Noble letterhead.
 */
export default async function ReportingPage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'report:view')) redirect('/dashboard');

  // Business-unit options for the filter (cached lookups from the LIS).
  const lookups = await getLookups().catch(() => ({
    businessUnits: [],
    statuses: [],
    departments: [],
  }));

  // Reporting only ever shows releasable samples (FULLY authorised / printed —
  // see searchReports.isReleasable), so the status filter must only offer
  // those; the pre-authorisation AND partially-* statuses would always yield
  // an empty list.
  const releasableStatuses = (lookups.statuses ?? []).filter(
    (s) => /(authoriz|authoris|print)/i.test(s) && !/partial/i.test(s),
  );

  // Client-facing roles (client_reporting): lock the report scope to their own
  // client code. A single-code scope pre-fills + disables the client-code and
  // business-unit filters; super_admin/admin (null scope) keep the free filters.
  const scope = await reportClientCodeScope(user);
  const lockedClientCode =
    scope && scope.size === 1 ? [...scope][0] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Reporting</h1>
        <p className="text-sm text-muted-foreground">
          Search lab results, preview the report, and download it on the Noble
          letterhead.
        </p>
      </div>
      <ReportingView
        businessUnits={lookups.businessUnits ?? []}
        statuses={releasableStatuses}
        lockedClientCode={lockedClientCode}
      />
    </div>
  );
}
