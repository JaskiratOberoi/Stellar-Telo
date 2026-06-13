import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { getOrder, redactFinancialFields } from '@/db/read/orders';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { RecordPaymentForm } from '@/components/payment/record-payment';
import { RecordRefundForm } from '@/components/payment/record-refund';
import { PrintLabButton, PrintBillButton } from '@/components/orders/print-bill-button';
import { EditPatientInfo } from '@/components/orders/edit-patient-info';
import { EditDiscount } from '@/components/orders/edit-discount';
import { VoidReceiptButton } from '@/components/orders/void-receipt-button';
import { CancelTestButton } from '@/components/orders/cancel-test-button';
import { fmtIST } from '@/lib/datetime';
import type { Capability } from '@/types/auth';
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

  // NOTE: this page used to wrap the body in <Suspense> for streamed first-
  // paint (the P2 perf pass). That broke the record-payment / refund form:
  // when those actions call revalidatePath inside a useActionState
  // transition, React 19 keeps `pending` true until the transition's
  // suspending boundary resolves — and with a Suspense + `force-dynamic`
  // combination above the re-fetching data, the transition could stall
  // indefinitely, leaving the Record button stuck on "Recording…" while
  // the receipt list silently fell behind the server state. Only a hard
  // refresh recovered. The page is a single getOrder + a tiny MCC-name
  // fetch (no slow split point to justify Suspense here), so rendering it
  // synchronously is simpler AND fixes the form-stuck regression.
  const user = await requireSession();
  const scope = await getMccScope(user.uid);
  const canViewBill = hasCapability(user.caps, 'bill:view');
  // `user:manage` is super-admin-exclusive — gates the patient-info editor.
  const isSuperAdmin = hasCapability(user.caps, 'user:manage');
  return (
    <ReceiptBody
      billId={billId}
      back={back}
      scope={scope}
      canViewBill={canViewBill}
      caps={user.caps}
      isSuperAdmin={isSuperAdmin}
    />
  );
}

async function ReceiptBody({
  billId,
  back,
  scope,
  canViewBill,
  caps,
  isSuperAdmin,
}: {
  billId: number;
  back: string | undefined;
  scope: number[];
  canViewBill: boolean;
  caps: Capability[];
  isSuperAdmin: boolean;
}) {
  const orderRaw = await getOrder(billId, scope);
  if (!orderRaw) notFound();

  // Defence in depth: technicians have `order:view` (worklist + accessioning)
  // but NOT `bill:view`, so they shouldn't see line totals, payments, balance
  // or discounts. Redact server-side so the values never leave the server even
  // via View-Source / RSC payload — the screen layout still renders a useful
  // patient + samples + tests view without amounts.
  const order = canViewBill ? orderRaw : redactFinancialFields(orderRaw);

  // Fetch MCC display name for the on-screen header. The invoice branding
  // config (logo bytes etc.) is no longer needed at this layer — print
  // templates are rendered on demand by `/print/orders/[id]/[kind]`, which
  // re-fetches the config when the user actually clicks print.
  const mccId = order.mccCode;
  // Self-include the order's own MCC so its name resolves even if the LIS flags
  // that centre inactive (e.g. a client centre like DL0002).
  const mccUnits =
    mccId != null ? await fetchScopedMccUnits([mccId], [mccId]) : [];
  const mccName = mccUnits[0]?.name ?? null;

  const canCapture = hasCapability(caps, 'payment:capture');
  const canPay = canViewBill && order.balance > 0 && canCapture;
  const canRefund =
    canViewBill && order.amountPaid > 0 && hasCapability(caps, 'payment:refund');

  const dateLabel = fmtIST(order.billDate);
  const genderLabel =
    order.gender === 1 ? 'Male' : order.gender === 2 ? 'Female' : order.gender ?? '—';

  return (
    <div>
      {/* Print templates are no longer SSR'd here. The Print buttons load
       *  /print/orders/[id]/(lab|bill) into a hidden iframe on click —
       *  cuts HTML payload for every order page visit and eliminates the
       *  duplicate-DOM cost. */}

      {/* ── Screen view: interactive web layout ──────────────────── */}
      <div className="space-y-4 print:hidden">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">
              Receipt #{order.billNumber ?? order.billId}
            </h1>
            {order.registeredByUsername && (
              <span
                title={
                  order.preparedByUser
                    ? `Registered by ${order.preparedByUser} (${order.registeredByUsername})`
                    : `Registered by ${order.registeredByUsername}`
                }
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">
                  Registered by
                </span>
                <span className="font-mono text-foreground">
                  {order.registeredByUsername}
                </span>
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {order.patientName ?? 'Patient'} · {dateLabel} ·{' '}
            {mccName ?? (
              <>MCC <span className="font-mono">{order.mccCode ?? '—'}</span></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PrintLabButton
            billId={order.billId}
            billNumber={order.billNumber ?? order.billId}
          />
          {canViewBill && (
            <PrintBillButton
              billId={order.billId}
              billNumber={order.billNumber ?? order.billId}
            />
          )}
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
          <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 pb-2">
            <CardTitle className="text-base">
              {order.patientName ?? 'Patient'}
            </CardTitle>
            {isSuperAdmin && (
              <EditPatientInfo
                billId={order.billId}
                patientName={order.patientName}
                age={order.age}
                ageType={order.ageType}
                gender={order.gender}
                mobile={order.mobile}
                email={order.email}
              />
            )}
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

      {/* Bottom row: Tests (wide) + Summary/Payment (narrow when bill view) */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className={canViewBill ? 'lg:col-span-8' : 'lg:col-span-12'}>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">
              Tests · {order.lines.filter((l) => l.amount > 0 && !l.cancelled).length}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Name</TableHead>
                  {canViewBill && (
                    <TableHead className="w-24 text-right">Amount</TableHead>
                  )}
                  {isSuperAdmin && <TableHead className="w-16" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((l, idx) => {
                  // amount < 0 → the negative "(Cancelled)" offset line added by
                  // a cancellation; `cancelled` → the original line that was
                  // cancelled (kept for the trail). Only an active positive,
                  // not-cancelled line gets a Cancel control.
                  const isCredit = l.amount < 0;
                  const dimmed = isCredit || l.cancelled;
                  return (
                    <TableRow key={idx}>
                      <TableCell
                        className={`font-mono text-xs ${dimmed ? 'text-muted-foreground line-through' : ''}`}
                      >
                        {l.testCode}
                      </TableCell>
                      <TableCell className={dimmed ? 'text-muted-foreground' : ''}>
                        <span className={l.cancelled ? 'line-through' : ''}>
                          {l.testName}
                        </span>
                        {l.cancelled && (
                          <span className="ml-1.5 rounded bg-white/10 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                            cancelled
                          </span>
                        )}
                      </TableCell>
                      {canViewBill && (
                        <TableCell
                          className={`text-right ${isCredit ? 'text-destructive' : ''}`}
                        >
                          {isCredit ? '− ' : ''}₹{Math.abs(l.amount)}
                        </TableCell>
                      )}
                      {isSuperAdmin && (
                        <TableCell className="text-right">
                          {l.amount > 0 && !l.cancelled && (
                            <CancelTestButton
                              billId={order.billId}
                              lineId={l.lineId}
                              testName={l.testName}
                              amount={l.amount}
                            />
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {canViewBill && (
          <Card variant="light" className="lg:col-span-4">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base text-zinc-900">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0 text-sm text-zinc-900">
              <div className="space-y-1">
                <Row label="Amount" value={`₹${order.amount}`} />
                {isSuperAdmin ? (
                  <EditDiscount
                    billId={order.billId}
                    amount={order.amount}
                    discount={order.discount}
                    amountPaid={order.amountPaid}
                  />
                ) : (
                  <Row label="Discount" value={`₹${order.discount}`} />
                )}
              </div>

              {order.receipts.length > 0 && (
                <div className="border-t border-zinc-200 pt-2 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    Payments &amp; refunds · {order.receipts.length}
                  </p>
                  <div className="space-y-1">
                    {order.receipts.map((rcpt, idx) => (
                      <ReceiptRow
                        key={idx}
                        rcpt={rcpt}
                        billId={order.billId}
                        canVoid={isSuperAdmin}
                      />
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
        )}
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
// with a leading minus so the running net is clear at a glance. Voided
// receipts are struck through and tagged — they no longer count toward the
// net (the void already reversed amount_paid). Super admins get a "Void"
// control on still-active receipts.
function ReceiptRow({
  rcpt,
  billId,
  canVoid,
}: {
  rcpt: import('@/db/read/orders').OrderReceipt;
  billId: number;
  canVoid: boolean;
}) {
  const isRefund = rcpt.kind === 'refund';
  const isVoided = rcpt.voided;
  const dateLabel = rcpt.date ? fmtIST(rcpt.date, 'date') : '—';
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className={`flex-1 truncate ${isVoided ? 'line-through opacity-60' : ''}`}>
        <span className="text-zinc-500">{dateLabel}</span>
        <span className="mx-1 text-zinc-300">·</span>
        <span className="text-zinc-900">{rcpt.method ?? 'Cash'}</span>
        {rcpt.txnId && (
          <>
            <span className="mx-1 text-zinc-300">·</span>
            <span className="font-mono text-zinc-700">{rcpt.txnId}</span>
          </>
        )}
        {rcpt.reference && (
          <>
            <span className="mx-1 text-zinc-300">·</span>
            <span className="font-mono text-zinc-600">{rcpt.reference}</span>
          </>
        )}
        {isRefund && (
          <span className="ml-1.5 rounded bg-red-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-700 no-underline">
            refund
          </span>
        )}
      </span>
      {isVoided && (
        <span className="rounded bg-zinc-200 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
          voided
        </span>
      )}
      {canVoid && !isVoided && (
        <VoidReceiptButton
          billId={billId}
          receiptId={rcpt.receiptId}
          kind={rcpt.kind}
          amount={rcpt.amount}
        />
      )}
      <span
        className={`${
          isRefund ? 'font-medium text-red-700' : 'font-medium text-zinc-900'
        } ${isVoided ? 'line-through opacity-60' : ''}`}
      >
        {isRefund ? '− ' : ''}₹{rcpt.amount.toLocaleString('en-IN')}
      </span>
    </div>
  );
}
