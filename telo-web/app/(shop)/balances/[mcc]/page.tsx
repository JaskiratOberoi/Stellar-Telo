import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getLedgerForMcc } from '@/actions/ledger.actions';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getMccScope } from '@/auth/scope';
import { fmtIST } from '@/lib/datetime';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const today = (): string => new Date().toISOString().slice(0, 10);
const firstOfMonth = (): string => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export default async function BalanceMccPage({
  params,
  searchParams,
}: {
  params: Promise<{ mcc: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { mcc } = await params;
  const mccId = Number(mcc);
  if (!Number.isInteger(mccId)) notFound();

  const user = await requireSession();
  if (!hasCapability(user.caps, 'balance:view')) redirect('/dashboard');

  const sp = await searchParams;
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : firstOfMonth();
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today();

  const [data, mccs, scope] = await Promise.all([
    getLedgerForMcc(mccId, { from, to }),
    fetchScopedMccUnits([mccId]),
    getMccScope(user.uid),
  ]);
  if (scope.length > 0 && scope.length <= 1000 && !scope.includes(mccId)) {
    redirect('/balances');
  }
  const mccMeta = mccs[0];
  const backHref = `/balances?from=${from}&to=${to}`;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {mccMeta?.name ?? `MCC ${mccId}`}{' '}
            <span className="font-mono text-base text-muted-foreground">
              {mccMeta?.code ?? mccId}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.bills.length} Telo bill
            {data.bills.length === 1 ? '' : 's'} · {inr(data.totalBalance)}{' '}
            balance · {fmtIST(from, 'date')} → {fmtIST(to, 'date')}
          </p>
        </div>
        <Link href={backHref} className="text-sm underline">
          ← Accounts summary
        </Link>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Bill #</TableHead>
            <TableHead className="w-32">Date</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead className="w-16 text-right">Age</TableHead>
            <TableHead className="w-24 text-right">Amount</TableHead>
            <TableHead className="w-24 text-right">Paid</TableHead>
            <TableHead className="w-24 text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.bills.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-muted-foreground">
                No Telo bills for this client in this date range.
              </TableCell>
            </TableRow>
          ) : (
            data.bills.map((b) => {
              const days = ageDays(b.billDate);
              return (
                <TableRow key={b.billId}>
                  <TableCell>
                    <Link
                      href={`/orders/${b.billId}`}
                      className="font-mono text-xs underline"
                    >
                      {b.billNumber ?? b.billId}
                    </Link>
                  </TableCell>
                  <TableCell>{fmtIST(b.billDate, 'date')}</TableCell>
                  <TableCell>{b.patientName ?? '—'}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {days != null ? `${days}d` : '—'}
                  </TableCell>
                  <TableCell className="text-right">{inr(b.amount)}</TableCell>
                  <TableCell className="text-right">
                    {inr(b.amountPaid)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {inr(b.balance)}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
