import { redirect } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getInvoiceConfigOverview } from '@/actions/invoiceConfig.actions';
import { invoiceConfigTableExists } from '@/db/read/invoiceConfig';
import { PageHeader } from '@/components/ui/page-header';
import { InvoiceConfigManager } from '@/components/admin/invoice-config-manager';

export const dynamic = 'force-dynamic';

export default async function AdminInvoicePage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'user:manage')) redirect('/dashboard');

  const [rows, tableReady] = await Promise.all([
    getInvoiceConfigOverview(),
    invoiceConfigTableExists(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoice settings"
        description="Set the lab name, address, phone and email that appear on the printed receipt for each client account."
        backHref="/admin/users"
        backLabel="User accounts"
        className="mb-0"
      />

      {!tableReady && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            aria-hidden
          />
          <p>
            <strong className="font-semibold">Migration not yet run.</strong>{' '}
            Execute{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              db/sql/06_table_telo_mcc_invoice_config.sql
            </code>{' '}
            against the Noble database to enable invoice configuration. The
            receipt page will use the MCC name from the LIS in the meantime.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-border/70 bg-card p-4 shadow-elevation-1 sm:p-5">
        <InvoiceConfigManager rows={rows} tableReady={tableReady} />
      </div>
    </div>
  );
}
