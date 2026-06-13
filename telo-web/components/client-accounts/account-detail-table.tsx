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

/**
 * Franchise-wallet transaction grid — mirrors the LIS Mcc_Account detail table.
 * Online rows (auto-posted by the LIS CCAvenue portal) show their generated txn
 * id (chequeorddnummber) + UPI RRN (reason) and carry an "Online" badge.
 * Inactive rows (debit_flag) are dimmed — they're excluded from payment totals.
 */
export function AccountDetailTable({ rows }: { rows: MccAccountDetailRow[] }) {
  return (
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
              <TableCell className="text-xs">{fmtIST(r.date, 'date')}</TableCell>
              <TableCell className="text-xs">{r.type}</TableCell>
              <TableCell className="font-mono text-xs">
                {r.chequeNo ?? '—'}
              </TableCell>
              <TableCell className="text-xs">
                <span className="inline-flex items-center gap-1.5">
                  {r.mode || '—'}
                  {r.isOnline && (
                    <span className="rounded-full bg-secondary/15 px-1.5 py-0.5 text-[10px] font-medium text-secondary">
                      Online
                    </span>
                  )}
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
  );
}
