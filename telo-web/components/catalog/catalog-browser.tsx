'use client';

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AddToCartButton } from '@/components/catalog/add-to-cart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { CatalogItemPublic, CatalogKind } from '@/domain/catalog/catalog.types';

const PAGE_SIZE = 100;

type KindFilter = CatalogKind | 'all';

/**
 * Client-side filter + paginated table for the catalog. Receives the full
 * cached catalog (~1.6k rows, ~130 KB) from the server once and filters in
 * memory thereafter. Eliminates the per-keystroke RSC round-trip the previous
 * URL-driven approach forced — typing is now genuinely instant and works
 * offline once the page is loaded.
 *
 * `costCt` is intentionally absent (callers pass `CatalogItemPublic[]` so the
 * cost column never leaks via the RSC payload).
 */
export function CatalogBrowser({
  items,
  canOrder,
}: {
  items: CatalogItemPublic[];
  canOrder: boolean;
}) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = items;
    if (kind !== 'all') out = out.filter((i) => i.kind === kind);
    if (needle) {
      out = out.filter(
        (i) =>
          i.name.toLowerCase().includes(needle) ||
          i.code.toLowerCase().includes(needle),
      );
    }
    return out;
  }, [items, q, kind]);

  const rows = filtered.slice(0, PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search tests or profiles by name or code…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md"
          autoFocus
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as KindFilter)}
          className="h-9 rounded-md border border-white/10 bg-input px-3 text-sm text-foreground focus:outline-none focus:border-primary"
        >
          <option value="all">All types</option>
          <option value="test">Tests</option>
          <option value="profile">Profiles</option>
        </select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length.toLocaleString('en-IN')} match
          {filtered.length === 1 ? '' : 'es'}
        </span>
      </div>

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
      {filtered.length > PAGE_SIZE && (
        <p className="text-xs text-muted-foreground">
          Showing first {PAGE_SIZE} of{' '}
          {filtered.length.toLocaleString('en-IN')} — refine your search to
          narrow results.
        </p>
      )}
    </div>
  );
}
