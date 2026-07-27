import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { listAuditLog } from '@/db/read/auditLog';
import { AuditTrail } from '@/components/admin/audit-trail';

export const dynamic = 'force-dynamic';

/**
 * Audit trail — every action performed on the Telo platform (sign-ins, orders,
 * payments, admin ops, report access, accessioning), persisted to
 * dbo.telo_audit_log by lib/audit.ts. Super Admin only: the trail spans every
 * client and user, so it carries the same `user:manage` gate as the admin
 * panel. Modelled on the LIS Audit Trail screen; see components/admin/
 * audit-trail.tsx for what was improved.
 */
export default async function AuditTrailPage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'user:manage')) redirect('/dashboard');

  const initial = await listAuditLog({ page: 1, pageSize: 50 });

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Audit trail</h1>
        <p className="text-sm text-muted-foreground">
          Every action performed on Telo — who did what, when, and to which
          record. Filter by category (reports, users, billing…), user, date or
          free text.
        </p>
      </div>
      <AuditTrail initial={initial} />
    </div>
  );
}
