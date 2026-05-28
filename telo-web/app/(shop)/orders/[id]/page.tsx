import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { getOrder } from '@/db/read/orders';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getMccInvoiceConfig, getMccInvoiceLogoBytes } from '@/db/read/invoiceConfig';
import { RecordPaymentForm } from '@/components/payment/record-payment';
import { RecordRefundForm } from '@/components/payment/record-refund';
import { PrintLabButton, PrintBillButton } from '@/components/orders/print-bill-button';
import { LabInvoice } from '@/components/orders/lab-invoice';
import { BillInvoice } from '@/components/orders/bill-invoice';
import { fmtIST } from '@/lib/datetime';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export default async function OrderReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const { back } = await searchParams;
  const billId = Number(id);
  if (!Number.isInteger(billId)) notFound();

  const user = await requireSession();
  const scope = await getMccScope(user.uid);
  const order = await getOrder(billId, scope);
  if (!order) notFound();

  // Fetch MCC display name + invoice branding config in parallel.
  const mccId = order.mccCode;
  const [mccUnits, invoiceConfig] = await Promise.all([
    mccId != null ? fetchScopedMccUnits([mccId]) : Promise.resolve([]),
    mccId != null ? getMccInvoiceConfig(mccId) : Promise.resolve(null),
  ]);
  const mccName = mccUnits[0]?.name ?? null;
  // String account code (MCCUnitCode) — distinct from numeric mccCode/mcc_id.
  // Used by BillInvoice to gate per-MCC branding (e.g. Medicare co-brand).
  const mccAccountCode = mccUnits[0]?.code ?? null;

  // Pre-fetch the per-MCC custom logo bytes server-side and inline them as a
  // data URI. Embedding avoids a fragile runtime image fetch from inside the
  // `hidden print:block` container — Chrome was snapshotting the print
  // before the lazy /api/mcc-invoice-logo/[id] response landed. With the
  // bytes in the markup, the logo is part of the document and prints every
  // time. Only fetched when the config says a logo exists for this MCC.
  const customLogoDataUri =
    mccId != null && invoiceConfig?.hasTopRightLogo
      ? await getMccInvoiceLogoBytes(mccId).then((logo) =>
          logo ? `data:${logo.mime};base64,${logo.bytes.toString('base64')}` : null,
        )
      : null;

  const canCapture = hasCapability(user.caps, 'payment:capture');
  const canPay = order.balance > 0 && canCapture;
  const canRefund = order.amountPaid > 0 && canCapture;

  const dateLabel = fmtIST(order.billDate);
  const genderLabel =
    order.gender === 1 ? 'Male' : order.gender === 2 ? 'Female' : order.gender ?? '—';

  return (
    <div>
      {/* ── Print: lab receipt (samples + tests) ─────────────────── */}
      <div className="hidden print:block" data-invoice="lab">
        <LabInvoice order={order} mccName={mccName} config={invoiceConfig} />
      </div>

      {/* ── Print: bill (costing only, no samples) ───────────────── */}
      <div className="hidden print:block" data-invoice="bill">
        <BillInvoice
          order={order}
          mccName={mccName}
          mccCode={mccAccountCode}
          config={invoiceConfig}
          customLogoDataUri={customLogoDataUri}
        />
      </div>

      {/* ── Screen view: interactive web layout ──────────────────── */}
      <div className="space-y-4 print:hidden">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Receipt #{order.billNumber ?? order.billId}
          </h1>
          <p className="text-xs text-muted-foreground">
            {order.patientName ?? 'Patient'} · {dateLabel} ·{' '}
            {mccName ?? (
              <>MCC <span className="font-mono">{order.mccCode ?? '—'}</span></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PrintLabButton billNumber={order.billNumber ?? order.billId} />
          <PrintBillButton billNumber={order.billNumber ?? order.billId} />
          <Link
            href={back ?? '/orders'}
            className="text-sm underline"
          >
            {back?.startsWith('/balances') ? '← Accounts' : '← All orders'}
          </Link>
        </div>
      </div>

      {/* Top row: Patient (narrow) + Samples (wide) */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-4">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">
              {order.patientName ?? 'Patient'}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 p-4 pt-0 text-sm">
            <span className="text-muted-foreground">Date</span>
            <span>{dateLabel}</span>
            <span className="text-muted-foreground">Client</span>
            <span>{mccName ?? <span className="font-mono text-xs">{order.mccCode ?? '—'}</span>}</span>
            <span className="text-muted-foreground">Age / Gender</span>
            <span>
              {order.age ?? '—'} / {genderLabel}
            </span>
            <span className="text-muted-foreground">Mobile</span>
            <span>{order.mobile ?? '—'}</span>
            {order.email && (
              <>
                <span className="text-muted-foreground">Email</span>
                <span className="truncate">{order.email}</span>
              </>
            )}
            {order.patientId != null && (
              <>
                <span className="text-muted-foreground">PID</span>
                <span className="font-mono">{order.patientId}</span>
              </>
            )}
            {order.refCustomerName && (
              <>
                <span className="text-muted-foreground">MRD / Visit</span>
                <span>{order.refCustomerName}</span>
              </>
            )}
            {order.refDoctorName && (
              <>
                <span className="text-muted-foreground">Ref. doctor</span>
                <span>{order.refDoctorName}</span>
              </>
            )}
            {order.paymentType && (
              <>
                <span className="text-muted-foreground">Payment</span>
                <span>{order.paymentType}</span>
              </>
            )}
          </CardContent>
        </Card>

        {order.samples.length > 0 && (
          <Card className="lg:col-span-8">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">
                Samples · {order.samples.length} SID
                {order.samples.length === 1 ? '' : 's'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {order.samples.map((s) => (
                  <div
                    key={s.vailid}
                    className="flex flex-col gap-1 rounded-md border p-2.5 text-sm"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-medium" title={s.sampleTypeName}>
                        {s.sampleTypeName}
                      </p>
                      {s.status && (
                        <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {s.status}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-sm">{s.vailid}</p>
                    <p
                      className="truncate font-mono text-xs text-muted-foreground"
                      title={s.testCodes ?? ''}
                    >
                      {s.testCodes ?? '—'}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Hand this slip to the patient — one barcode per listed sample type.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Bottom row: Tests (wide) + Summary/Payment (narrow) */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">
              Tests · {order.lines.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-24 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((l, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-xs">
                      {l.testCode}
                    </TableCell>
                    <TableCell>{l.testName}</TableCell>
                    <TableCell className="text-right">₹{l.amount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card variant="light" className="lg:col-span-4">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base text-zinc-900">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0 text-sm text-zinc-900">
            <div className="space-y-1">
              <Row label="Amount" value={`₹${order.amount}`} />
              <Row label="Discount" value={`₹${order.discount}`} />
            </div>

            {order.receipts.length > 0 && (
              <div className="border-t border-zinc-200 pt-2 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Payments &amp; refunds · {order.receipts.length}
                </p>
                <div className="space-y-1">
                  {order.receipts.map((rcpt, idx) => (
                    <ReceiptRow key={idx} rcpt={rcpt} />
                  ))}
                </div>
                <div className="border-t border-zinc-200 pt-1.5">
                  <Row label="Net paid" value={`₹${order.amountPaid}`} />
                </div>
              </div>
            )}
            {order.receipts.length === 0 && (
              <div className="border-t border-zinc-200 pt-2">
                <Row label="Paid" value={`₹${order.amountPaid}`} />
              </div>
            )}

            <div className="border-t border-zinc-200 pt-2">
              <Row label="Balance" value={`₹${order.balance}`} bold />
            </div>
            {canPay && (
              <div className="border-t border-zinc-200 pt-3">
                <RecordPaymentForm
                  billId={order.billId}
                  balance={order.balance}
                />
              </div>
            )}
            {canRefund && (
              <div className="border-t border-zinc-200 pt-3">
                <RecordRefundForm
                  billId={order.billId}
                  amountPaid={order.amountPaid}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </div>{/* end screen view */}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${bold ? 'font-semibold text-zinc-900' : 'text-zinc-500'}`}
    >
      <span>{label}</span>
      <span className={bold ? '' : 'text-zinc-900'}>{value}</span>
    </div>
  );
}

// One line per payment / refund in the Summary card. Refunds show in red
// with a leading minus so the running net is clear at a glance.
function ReceiptRow({
  rcpt,
}: {
  rcpt: import('@/db/read/orders').OrderReceipt;
}) {
  const isRefund = rcpt.kind === 'refund';
  const dateLabel = rcpt.date ? fmtIST(rcpt.date, 'date') : '—';
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="flex-1 truncate">
        <span className="text-zinc-500">{dateLabel}</span>
        <span className="mx-1 text-zinc-300">·</span>
        <span className="text-zinc-900">{rcpt.method ?? 'Cash'}</span>
        {rcpt.reference && (
          <>
            <span className="mx-1 text-zinc-300">·</span>
            <span className="font-mono text-zinc-600">{rcpt.reference}</span>
          </>
        )}
        {isRefund && (
          <span className="ml-1.5 rounded bg-red-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-700">
            refund
          </span>
        )}
      </span>
      <span
        className={
          isRefund ? 'font-medium text-red-700' : 'font-medium text-zinc-900'
        }
      >
        {isRefund ? '− ' : ''}₹{rcpt.amount.toLocaleString('en-IN')}
      </span>
    </div>
  );
}
