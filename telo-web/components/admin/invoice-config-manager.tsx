'use client';

import { useMemo, useState, useActionState } from 'react';
import Image from 'next/image';
import {
  saveInvoiceConfigAction,
  type InvoiceConfigState,
} from '@/actions/invoiceConfig.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { customLogoApiPath, MEDICARE_MCC_CODES } from '@/lib/invoice-logo';

const PAGE_SIZE = 50;

interface MccRow {
  mccId: number;
  mccCode: string;
  mccName: string | null;
  config: {
    labName: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    hasTopRightLogo: boolean;
  } | null;
}

const initial: InvoiceConfigState = { error: null, ok: false };

function ConfigForm({ row, onClose }: { row: MccRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(saveInvoiceConfigAction, initial);
  const [removeLogo, setRemoveLogo] = useState(false);
  const hasLogo = row.config?.hasTopRightLogo ?? false;
  const isMedicareDefault =
    MEDICARE_MCC_CODES.has(row.mccCode.trim().toLowerCase()) && !hasLogo;

  return (
    <form action={action} encType="multipart/form-data" className="space-y-3 pt-2">
      <input type="hidden" name="mccId" value={row.mccId} />
      {removeLogo && <input type="hidden" name="removeLogo" value="1" />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`ln-${row.mccId}`}>Lab / clinic name</Label>
          <Input
            id={`ln-${row.mccId}`}
            name="labName"
            placeholder={row.mccName ?? 'Display name on invoice'}
            defaultValue={row.config?.labName ?? ''}
          />
          <p className="text-xs text-muted-foreground">
            Overrides &ldquo;{row.mccName ?? row.mccCode}&rdquo; on the invoice header.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`ph-${row.mccId}`}>Phone</Label>
          <Input
            id={`ph-${row.mccId}`}
            name="phone"
            placeholder="+91 98765 43210"
            defaultValue={row.config?.phone ?? ''}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`ad-${row.mccId}`}>Address</Label>
          <Input
            id={`ad-${row.mccId}`}
            name="address"
            placeholder="123 Main Street, City — 110001"
            defaultValue={row.config?.address ?? ''}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`em-${row.mccId}`}>Email</Label>
          <Input
            id={`em-${row.mccId}`}
            name="email"
            type="email"
            placeholder="lab@example.com"
            defaultValue={row.config?.email ?? ''}
          />
        </div>
        <div className="space-y-2 sm:col-span-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <Label htmlFor={`logo-${row.mccId}`}>Top-right logo (optional)</Label>
          <p className="text-xs text-muted-foreground">
            Shown on the bill header opposite the Noble logo — same placement as the
            built-in Medicare logo for{' '}
            <span className="font-mono">medicare_test</span> /{' '}
            <span className="font-mono">medicare_tech</span>. Stored in Telo only.
          </p>
          {hasLogo && !removeLogo && (
            <div className="flex items-center gap-3">
              <Image
                src={customLogoApiPath(row.mccId)}
                alt="Current top-right logo"
                width={104}
                height={72}
                unoptimized
                className="h-14 w-auto rounded border border-white/10 bg-white p-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRemoveLogo(true)}
              >
                Remove logo
              </Button>
            </div>
          )}
          {removeLogo && (
            <p className="text-xs text-amber-400">
              Logo will be removed when you save.
              {isMedicareDefault && ' The built-in Medicare logo will show again.'}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="ml-1 h-auto p-0 text-xs"
                onClick={() => setRemoveLogo(false)}
              >
                Undo
              </Button>
            </p>
          )}
          {isMedicareDefault && !removeLogo && (
            <p className="text-xs text-secondary">
              No custom logo — bills use the built-in Medicare logo for this account code.
            </p>
          )}
          <Input
            id={`logo-${row.mccId}`}
            name="topRightLogo"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="cursor-pointer file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs"
          />
          <p className="text-xs text-muted-foreground">PNG, JPEG, WebP, or GIF · max 2 MB</p>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {state.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
        {state.ok && (
          <p className="text-sm text-secondary">Saved.</p>
        )}
      </div>
    </form>
  );
}

function rowHasConfig(row: MccRow): boolean {
  const c = row.config;
  return !!(c?.labName || c?.address || c?.phone || c?.email || c?.hasTopRightLogo);
}

export function InvoiceConfigManager({
  rows,
  tableReady = true,
}: {
  rows: MccRow[];
  tableReady?: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);

  // Sort once: configured rows first, then by name. Stable across renders.
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ac = rowHasConfig(a) ? 0 : 1;
      const bc = rowHasConfig(b) ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return (a.mccName ?? a.mccCode).localeCompare(b.mccName ?? b.mccCode);
    });
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter(
      (r) =>
        (r.mccName ?? '').toLowerCase().includes(needle) ||
        r.mccCode.toLowerCase().includes(needle) ||
        String(r.mccId).includes(needle) ||
        (r.config?.labName ?? '').toLowerCase().includes(needle),
    );
  }, [sorted, q]);

  const visible = showAll ? filtered : filtered.slice(0, PAGE_SIZE);
  const configuredCount = useMemo(() => rows.filter(rowHasConfig).length, [rows]);

  if (rows.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        {tableReady
          ? 'No client accounts in scope for your account.'
          : 'No client accounts in scope. Run the SQL migration (06_table_telo_mcc_invoice_config.sql) first if the table is missing.'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          placeholder="Search by MCC name, code, ID, or saved lab name…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setShowAll(false);
          }}
          className="h-8 max-w-md"
          suppressHydrationWarning
        />
        <p className="text-xs text-muted-foreground">
          {configuredCount} configured · {rows.length} total
          {q && ` · ${filtered.length} match`}
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">No match.</p>
      ) : (
        <div className="divide-y divide-white/5">
          {visible.map((row) => {
            const isOpen = editing === row.mccId;
            const hasConfig = rowHasConfig(row);
            return (
              <div
                key={row.mccId}
                className={cn(
                  'px-1 py-3',
                  isOpen && 'rounded-lg bg-white/[0.02] px-3',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {row.config?.labName ?? row.mccName ?? '—'}
                      {hasConfig && (
                        <span className="ml-2 rounded-full bg-secondary/15 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wider text-secondary">
                          Configured
                        </span>
                      )}
                      {row.config?.hasTopRightLogo && (
                        <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Logo
                        </span>
                      )}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {row.mccCode} · ID {row.mccId}
                    </p>
                    {hasConfig && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[row.config?.phone, row.config?.email]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(isOpen ? null : row.mccId)}
                  >
                    {isOpen ? 'Close' : hasConfig ? 'Edit' : 'Set up'}
                  </Button>
                </div>
                {isOpen && (
                  <ConfigForm row={row} onClose={() => setEditing(null)} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {!showAll && filtered.length > PAGE_SIZE && (
        <div className="flex justify-center pt-2">
          <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
            Show all {filtered.length}
          </Button>
        </div>
      )}
    </div>
  );
}
