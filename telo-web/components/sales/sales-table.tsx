import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { SalesRow } from '@/db/read/salesData';
import { fmtIST } from '@/lib/datetime';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const AGE_UNIT: Record<number, string> = { 1: 'y', 2: 'mo', 3: 'd' };
const GENDER: Record<number, string> = { 1: 'M', 2: 'F' };

/** "45y · M" / "45y" / "M" / "—" from the patient's age + gender codes. */
function ageSex(r: SalesRow): string {
  const age =
    r.age != null ? `${r.age}${r.ageType != null ? (AGE_UNIT[r.ageType] ?? '') : ''}` : null;
  const sex = r.gender != null ? (GENDER[r.gender] ?? null) : null;
  return [age, sex].filter(Boolean).join(' · ') || '—';
}

/**
 * Itemised sales lines — one row per billable test, mirroring the LIS
 * Sales Data grid (SID / PID / Patient / Age·Sex / Date / Test / Names /
 * Amount / Ref doctor·customer). SID is the sample (vailid) the test belongs
 * to; PID is the patient registration id; Date is the sample/registration date.
 */
export function SalesTable({ rows }: { rows: SalesRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">SID</TableHead>
          <TableHead className="w-20">PID</TableHead>
          <TableHead>Patient</TableHead>
          <TableHead className="w-20">Age / Sex</TableHead>
          <TableHead className="w-28">Date</TableHead>
          <TableHead className="w-24">Test</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Ref. Doctor / Customer</TableHead>
          <TableHead className="w-24 text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={9} className="text-muted-foreground">
              No sales in this range.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r, i) => (
            <TableRow key={`${r.regdNo}-${r.testCode}-${i}`}>
              <TableCell className="font-mono text-xs">{r.sid ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {r.regdNo}
              </TableCell>
              <TableCell className="font-medium">
                {r.patientName ?? '—'}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {ageSex(r)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {r.sampleDate ? fmtIST(r.sampleDate, 'date') : '—'}
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
