import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getMccScope } from '@/auth/scope';
import { hasCapability } from '@/auth/rbac';
import { searchPatients } from '@/db/read/patient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export default async function PatientLookupPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'patient:view')) {
    redirect('/dashboard');
  }

  const sp = await searchParams;
  const term = (sp.q ?? '').trim();
  const scope = await getMccScope(user.uid);
  const hits = term ? await searchPatients(term, scope, 25) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Patient lookup</h1>
        <p className="text-muted-foreground">
          Search by name, mobile, or patient ID — scoped to your{' '}
          {scope.length} collection centre{scope.length === 1 ? '' : 's'}
        </p>
      </div>

      <form className="flex max-w-md gap-2" action="/patient" method="get">
        <Input
          name="q"
          defaultValue={term}
          placeholder="Name, mobile, or PID"
          autoFocus
        />
        <Button type="submit">Search</Button>
      </form>

      {term && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">PID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-16">Age</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead className="w-20">MCC</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hits.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No patients found in your scope.
                </TableCell>
              </TableRow>
            ) : (
              hits.map((p) => (
                <TableRow key={p.pid}>
                  <TableCell className="font-mono text-xs">{p.pid}</TableCell>
                  <TableCell>{p.name ?? '—'}</TableCell>
                  <TableCell>{p.age ?? '—'}</TableCell>
                  <TableCell>{p.mobile ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.mccCode ?? '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
