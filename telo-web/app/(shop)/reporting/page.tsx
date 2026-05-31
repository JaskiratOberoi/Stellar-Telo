import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getLookups } from '@/lib/listec';
import { ReportingView } from '@/components/reporting/reporting-view';

export const dynamic = 'force-dynamic';

/**
 * Reporting tab — customer-facing TSH (BI221) reports. Super-admin only for
 * now (gated by `report:view`, which `auth/rbac.ts` grants to super_admin
 * alone). Users filter for results, preview the formatted report, and download
 * it as a PDF on the Noble letterhead.
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Reporting</h1>
        <p className="text-sm text-muted-foreground">
          Search lab results, preview the report, and download it on the Noble
          letterhead.
        </p>
      </div>
      <ReportingView businessUnits={lookups.businessUnits ?? []} />
    </div>
  );
}
