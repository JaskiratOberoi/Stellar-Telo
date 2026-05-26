import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { loadCatalog, filterCatalog } from '@/db/read/catalog';
import { CatalogSearchBox } from '@/components/catalog/search-box';
import { AddToCartButton } from '@/components/catalog/add-to-cart';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string }>;
}) {
  const user = await requireSession();
  const canOrder = hasCapability(user.caps, 'order:create');
  const sp = await searchParams;
  const kind =
    sp.kind === 'test' || sp.kind === 'profile' ? sp.kind : 'all';

  const all = await loadCatalog();
  const rows = filterCatalog(all, sp.q, kind, 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Catalog</h1>
        <p className="text-muted-foreground">
          {all.length.toLocaleString()} active tests &amp; profiles · MRP pricing
        </p>
      </div>

      <CatalogSearchBox />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-24">Type</TableHead>
            <TableHead className="w-24 text-right">MRP</TableHead>
            {canOrder && <TableHead className="w-20" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={canOrder ? 5 : 4}
                className="text-muted-foreground"
              >
                No matches.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((i) => (
              <TableRow key={`${i.kind}-${i.id}`}>
                <TableCell className="font-mono text-xs">{i.code}</TableCell>
                <TableCell>{i.name}</TableCell>
                <TableCell>
                  <Badge
                    variant={i.kind === 'profile' ? 'secondary' : 'outline'}
                  >
                    {i.kind}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {i.mrp != null ? `₹${i.mrp}` : '—'}
                </TableCell>
                {canOrder && (
                  <TableCell className="text-right">
                    <AddToCartButton
                      item={{
                        id: i.id,
                        kind: i.kind,
                        code: i.code,
                        name: i.name,
                      }}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {rows.length === 100 && (
        <p className="text-xs text-muted-foreground">
          Showing first 100 — refine your search to narrow results.
        </p>
      )}
    </div>
  );
}
