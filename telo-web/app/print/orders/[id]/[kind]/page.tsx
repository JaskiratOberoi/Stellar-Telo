import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { getOrder, redactFinancialFields } from '@/db/read/orders';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getMccInvoiceConfig } from '@/db/read/invoiceConfig';
import { customLogoApiPath } from '@/lib/invoice-logo';
import { LabInvoice } from '@/components/orders/lab-invoice';
import { BillInvoice } from '@/components/orders/bill-invoice';

export const dynamic = 'force-dynamic';

/**
 * Print fragment: a standalone page that renders just one invoice template
 * (lab or bill) with the standard Tailwind layer. Loaded into the print
 * iframe on demand instead of SSRing both templates inside every order page
 * visit (which inflated HTML payload + duplicated DOM on every render).
 *
 * Auth: requires session via middleware; the bill variant additionally
 * requires `bill:view`, matching the gate on the order page itself.
 */
export default async function PrintFragmentPage({
  params,
}: {
  params: Promise<{ id: string; kind: string }>;
}) {
  const { id, kind } = await params;
  if (kind !== 'lab' && kind !== 'bill') notFound();
  const billId = Number(id);
  if (!Number.isInteger(billId)) notFound();

  const user = await requireSession();
  const canViewBill = hasCapability(user.caps, 'bill:view');
  // Don't render the bill fragment for users without bill:view — even if the
  // URL is hand-typed, they shouldn't see line totals / balance.
  if (kind === 'bill' && !canViewBill) notFound();

  const scope = await getMccScope(user.uid);
  const orderRaw = await getOrder(billId, scope);
  if (!orderRaw) notFound();
  const order = canViewBill ? orderRaw : redactFinancialFields(orderRaw);

  const mccId = order.mccCode;
  const [mccUnits, invoiceConfig] = await Promise.all([
    mccId != null ? fetchScopedMccUnits([mccId]) : Promise.resolve([]),
    mccId != null ? getMccInvoiceConfig(mccId) : Promise.resolve(null),
  ]);
  const mccName = mccUnits[0]?.name ?? null;
  const mccAccountCode = mccUnits[0]?.code ?? null;
  const customLogoSrc =
    mccId != null && invoiceConfig?.hasTopRightLogo
      ? customLogoApiPath(mccId)
      : null;

  // The print iframe loads this page with an explicit @media print stylesheet
  // applied via the surrounding <html class="print-bill|print-lab">. The
  // print-bill-button assigns that class via the iframe srcdoc shell, so the
  // fragment doesn't need to manage it here.
  if (kind === 'lab') {
    return (
      <div data-invoice="lab">
        <LabInvoice order={order} mccName={mccName} config={invoiceConfig} />
      </div>
    );
  }

  return (
    <div data-invoice="bill">
      <BillInvoice
        order={order}
        mccName={mccName}
        mccCode={mccAccountCode}
        config={invoiceConfig}
        customLogoSrc={customLogoSrc}
      />
    </div>
  );
}
