import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getAccessionView } from '@/actions/accession.actions';
import { AccessionForm } from '@/components/register/accession-form';
import { fmtIST } from '@/lib/datetime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export default async function AccessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const billId = Number(id);
  if (!Number.isInteger(billId)) notFound();
  // Return to whichever worklist opened this order (New vs B2B Orders tab).
  const { from } = await searchParams;
  const worklistHref = from === 'b2b' ? '/orders/b2b' : '/orders/new';

  const user = await requireSession();
  // Accessioning (adding SIDs to an existing order) — a Technician can do
  // this without having order:create (which is for the registration FAB).
  if (!hasCapability(user.caps, 'order:accession')) redirect('/dashboard');

  const view = await getAccessionView(billId);
  if (!view) notFound();

  const { order, groups, complete } = view;
  const genderLabel =
    order.gender === 1 ? 'Male' : order.gender === 2 ? 'Female' : '—';

  // Lab technicians only need pass/fail payment status here — amounts live on
  // the bill. Same logic as LabInvoice's PaymentStatusPill.
  const paymentStatus: 'paid' | 'pending' | 'free' =
    order.balance > 0
      ? 'pending'
      : order.amountPaid > 0
        ? 'paid'
        : 'free';

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold tracking-tight">
            Accession · Bill #{order.billNumber ?? order.billId}
          </h1>
          <PaymentStatusPill status={paymentStatus} />
        </div>
        <Link href={worklistHref} className="text-sm underline">
          ← Worklist
        </Link>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {order.patientName ?? 'Patient'} · {fmtIST(order.billDate)} · MCC{' '}
        <span className="font-mono">{order.mccCode ?? '—'}</span>
      </p>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Patient — read-only; Telo never edits patient details */}
        <Card className="lg:col-span-4">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">
              {order.patientName ?? 'Patient'}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 p-4 pt-0 text-sm">
            <span className="text-muted-foreground">Age / Gender</span>
            <span>
              {order.age ?? '—'} / {genderLabel}
            </span>
            <span className="text-muted-foreground">Mobile</span>
            <span>{order.mobile ?? '—'}</span>
            <span className="col-span-2 mt-1 text-xs text-muted-foreground">
              Patient details are read-only here — edit them in the LIS.
            </span>
          </CardContent>
        </Card>

        {/* Tests — read-only; amounts intentionally hidden for technicians */}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((l, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-xs">
                      {l.testCode}
                    </TableCell>
                    <TableCell>{l.testName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Sample IDs</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {complete ? (
            <p className="rounded-md border border-secondary/30 bg-secondary/10 px-3 py-2 text-sm text-secondary">
              All sample types are accessioned for this order.
            </p>
          ) : (
            <AccessionForm billId={order.billId} groups={groups} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentStatusPill({
  status,
}: {
  status: 'paid' | 'pending' | 'free';
}) {
  const styles =
    status === 'paid'
      ? 'border-secondary/40 bg-secondary/15 text-secondary'
      : status === 'pending'
        ? 'border-destructive/40 bg-destructive/15 text-destructive'
        : 'border-foreground/15 bg-foreground/5 text-muted-foreground';
  const label =
    status === 'paid'
      ? '✓ Paid'
      : status === 'pending'
        ? 'Payment Pending'
        : 'No Charge';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${styles}`}
    >
      {label}
    </span>
  );
}
