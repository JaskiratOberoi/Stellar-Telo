import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fmtIST } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import type { MccAccountDetailRow } from '@/db/read/mccLedger';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function OnlineBadge() {
  return (
    <span className="rounded-full bg-secondary/15 px-1.5 py-0.5 text-[10px] font-medium text-secondary">
      Online
    </span>
  );
}

/**
 * Franchise-wallet transaction grid — mirrors the LIS Mcc_Account detail table.
 * Online rows (auto-posted by the CCAvenue portal) show their generated txn id
 * (chequeorddnummber) + UPI RRN (reason) and carry an "Online" badge. Inactive
 * rows (debit_flag) are dimmed — excluded from payment totals.
 *
 * Responsive: a scrolling table from `sm` up; stacked cards on phones, where a
 * 6-column table is unreadable.
 */
export function AccountDetailTable({ rows }: { rows: MccAccountDetailRow[] }) {
  return (
    <>
      {/* Mobile (<sm): one card per transaction. */}
      <div className="space-y-2 sm:hidden">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-foreground/5 bg-card p-4 text-sm text-muted-foreground">
            No transactions in this range.
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className={cn(
                'rounded-lg border border-foreground/5 bg-card p-3',
                r.inactive && 'opacity-50',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{fmtIST(r.date, 'date')}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{r.type}</span>
                    {r.mode && <span>· {r.mode}</span>}
                    {r.isOnline && <OnlineBadge />}
                  </p>
                </div>
                <p className="shrink-0 text-base font-semibold tabular-nums">
                  {inr(r.amount)}
                </p>
              </div>
              {(r.chequeNo || r.reason) && (
                <dl className="mt-2 space-y-1 border-t border-foreground/5 pt-2 text-xs">
                  {r.chequeNo && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Cheque / Txn No</dt>
                      <dd className="break-all text-right font-mono">
                        {r.chequeNo}
                      </dd>
                    </div>
                  )}
                  {r.reason && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Reason / Ref</dt>
                      <dd className="break-all text-right">{r.reason}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          ))
        )}
      </div>

      {/* Desktop (sm+): the full table. */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Date</TableHead>
              <TableHead className="w-24">Type</TableHead>
              <TableHead>Cheque / Txn No</TableHead>
              <TableHead className="w-40">Mode</TableHead>
              <TableHead className="w-28 text-right">Amount</TableHead>
              <TableHead>Reason / Ref</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No transactions in this range.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className={cn(r.inactive && 'opacity-50')}>
                  <TableCell className="text-xs">
                    {fmtIST(r.date, 'date')}
                  </TableCell>
                  <TableCell className="text-xs">{r.type}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.chequeNo ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      {r.mode || '—'}
                      {r.isOnline && <OnlineBadge />}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{inr(r.amount)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.reason ?? '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
