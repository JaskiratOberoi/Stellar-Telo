import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { SalesRow } from '@/db/read/salesData';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/**
 * Itemised sales lines — one row per billable test, mirroring the LIS
 * Sales Data grid (Patient / Test / Names / Amount / Ref doctor·customer).
 */
export function SalesTable({ rows }: { rows: SalesRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Patient</TableHead>
          <TableHead className="w-24">Test</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Ref. Doctor / Customer</TableHead>
          <TableHead className="w-24 text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-muted-foreground">
              No sales in this range.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r, i) => (
            <TableRow key={`${r.regdNo}-${r.testCode}-${i}`}>
              <TableCell className="font-medium">
                {r.patientName ?? '—'}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {r.testCode ?? '—'}
              </TableCell>
              <TableCell className="text-xs">{r.testName ?? '—'}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {[r.doctor, r.customer].filter(Boolean).join(' · ') || '—'}
              </TableCell>
              <TableCell className="text-right">{inr(r.amount)}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
