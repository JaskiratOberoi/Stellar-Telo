'use client';

import { useMemo, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search, SearchX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AddToCartButton } from '@/components/catalog/add-to-cart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  CatalogItemPriced,
  CatalogKind,
  CatalogRateSource,
} from '@/domain/catalog/catalog.types';
import type { ScopedMcc } from '@/db/read/mccUnits';

const PAGE_SIZE = 100;

type KindFilter = CatalogKind | 'all';

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'test', label: 'Tests' },
  { value: 'profile', label: 'Profiles' },
  { value: 'master', label: 'Packages' },
];

/** Where the row's rate came from → badge tone. */
const RATE_SOURCE_VARIANT: Record<
  CatalogRateSource,
  NonNullable<BadgeProps['variant']>
> = {
  mrp: 'muted',
  ratelist: 'info',
  special: 'success',
  none: 'destructive',
};

const KIND_VARIANT: Record<CatalogKind, NonNullable<BadgeProps['variant']>> = {
  master: 'default',
  profile: 'info',
  test: 'outline',
};

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
  units = [],
  selectedMccId = null,
  inCartKeys = [],
}: {
  items: CatalogItemPriced[];
  canOrder: boolean;
  units?: ScopedMcc[];
  selectedMccId?: number | null;
  /** `${kind}-${id}` keys already in the order cart — seeds each row's
   *  Added/Remove state on load. */
  inCartKeys?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [switching, startSwitch] = useTransition();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');

  const inCart = useMemo(() => new Set(inCartKeys), [inCartKeys]);

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
  const hasActiveFilters = q.trim() !== '' || kind !== 'all';

  return (
    <div className="space-y-4 animate-fade-in motion-reduce:animate-none">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-md">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search tests or profiles by name or code…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div
          role="group"
          aria-label="Filter by item type"
          className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5 shadow-elevation-1"
        >
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={kind === f.value}
              onClick={() => setKind(f.value)}
              className={cn(
                'h-8 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                kind === f.value
                  ? 'bg-card text-foreground shadow-elevation-1'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {units.length > 1 && (
          <select
            aria-label="Client rate list"
            suppressHydrationWarning
            value={selectedMccId ?? ''}
            disabled={switching}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!v) return;
              startSwitch(() => {
                router.push(`${pathname}?mcc=${v}`);
              });
            }}
            className="h-9 max-w-[16rem] rounded-md border border-border bg-input px-3 text-sm text-foreground shadow-elevation-1 transition-[border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.code} ({u.code})
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
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
            <TableHead className="w-44 text-right">Rate</TableHead>
            {canOrder && <TableHead className="w-36" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={canOrder ? 5 : 4}>
                <div className="flex flex-col items-center gap-2 py-12 text-center animate-fade-in motion-reduce:animate-none">
                  <SearchX
                    aria-hidden
                    className="h-8 w-8 text-muted-foreground/50"
                  />
                  <p className="text-sm font-medium">
                    No matching tests or profiles
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Try a different name or code, or widen the type filter.
                  </p>
                  {hasActiveFilters && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1"
                      onClick={() => {
                        setQ('');
                        setKind('all');
                      }}
                    >
                      Clear search &amp; filters
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((i) => (
              <TableRow key={`${i.kind}-${i.id}`}>
                <TableCell className="font-mono text-xs">{i.code}</TableCell>
                <TableCell className="font-medium">{i.name}</TableCell>
                <TableCell>
                  <Badge variant={KIND_VARIANT[i.kind]}>
                    {i.kind === 'master' ? 'package' : i.kind}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Badge variant={RATE_SOURCE_VARIANT[i.rateSource]}>
                      {i.rateSource}
                    </Badge>
                    <span className="font-medium tabular-nums">
                      {i.rate != null ? `₹${i.rate}` : '—'}
                    </span>
                  </div>
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
                      initiallyAdded={inCart.has(`${i.kind}-${i.id}`)}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {filtered.length > PAGE_SIZE && (
        <p className="text-xs tabular-nums text-muted-foreground">
          Showing first {PAGE_SIZE} of{' '}
          {filtered.length.toLocaleString('en-IN')} — refine your search to
          narrow results.
        </p>
      )}
    </div>
  );
}
