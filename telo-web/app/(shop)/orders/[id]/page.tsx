import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope } from '@/auth/scope';
import { getOrder } from '@/db/read/orders';
import { RecordPaymentForm } from '@/components/payment/record-payment';
import { RecordRefundForm } from '@/components/payment/record-refund';
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const billId = Number(id);
  if (!Number.isInteger(billId)) notFound();

  const user = await requireSession();
  const scope = await getMccScope(user.uid);
  const order = await getOrder(billId, scope);
  if (!order) notFound();

  const canCapture = hasCapability(user.caps, 'payment:capture');
  const canPay = order.balance > 0 && canCapture;
  const canRefund = order.amountPaid > 0 && canCapture;

  const dateLabel = fmtIST(order.billDate);
  const genderLabel =
    order.gender === 1 ? 'Male' : order.gender === 2 ? 'Female' : order.gender ?? '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Receipt #{order.billNumber ?? order.billId}
          </h1>
          <p className="text-xs text-muted-foreground">
            {order.patientName ?? 'Patient'} · {dateLabel} · MCC{' '}
            <span className="font-mono">{order.mccCode ?? '—'}</span>
          </p>
        </div>
        <Link href="/orders" className="text-sm underline">
          ← All orders
        </Link>
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
            <span className="text-muted-foreground">MCC</span>
            <span className="font-mono">{order.mccCode ?? '—'}</span>
            <span className="text-muted-foreground">Age / Gender</span>
            <span>
              {order.age ?? '—'} / {genderLabel}
            </span>
            <span className="text-muted-foreground">Mobile</span>
            <span>{order.mobile ?? '—'}</span>
            {order.patientId != null && (
              <>
                <span className="text-muted-foreground">PID</span>
                <span className="font-mono">{order.patientId}</span>
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
                        <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
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

        <Card className="lg:col-span-4">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0 text-sm">
            <div className="space-y-1">
              <Row label="Amount" value={`₹${order.amount}`} />
              <Row label="Discount" value={`₹${order.discount}`} />
              <Row label="Paid" value={`₹${order.amountPaid}`} />
              <div className="border-t pt-1">
                <Row label="Balance" value={`₹${order.balance}`} bold />
              </div>
            </div>
            {canPay && (
              <div className="border-t pt-3">
                <RecordPaymentForm
                  billId={order.billId}
                  balance={order.balance}
                />
              </div>
            )}
            {canRefund && (
              <div className="border-t pt-3">
                <RecordRefundForm
                  billId={order.billId}
                  amountPaid={order.amountPaid}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
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
      className={`flex justify-between ${bold ? 'font-semibold' : 'text-muted-foreground'}`}
    >
      <span>{label}</span>
      <span className={bold ? '' : 'text-foreground'}>{value}</span>
    </div>
  );
}
