import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getInvoiceConfigOverview } from '@/actions/invoiceConfig.actions';
import { invoiceConfigTableExists } from '@/db/read/invoiceConfig';
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
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Invoice settings</h1>
          <p className="text-sm text-muted-foreground">
            Set the lab name, address, phone and email that appear on the printed
            receipt for each client account.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm">
          <Link href="/admin/roles" className="underline">
            Roles &amp; permissions
          </Link>
          <Link href="/admin/users" className="underline">
            ← User accounts
          </Link>
        </div>
      </div>

      {!tableReady && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          <strong>Migration not yet run.</strong> Execute{' '}
          <code className="font-mono text-xs bg-foreground/10 px-1 py-0.5 rounded">
            db/sql/06_table_telo_mcc_invoice_config.sql
          </code>{' '}
          against the Noble database to enable invoice configuration. The receipt
          page will use the MCC name from the LIS in the meantime.
        </div>
      )}

      <div className="rounded-lg border border-foreground/5 bg-card p-4">
        <InvoiceConfigManager rows={rows} tableReady={tableReady} />
      </div>
    </div>
  );
}
