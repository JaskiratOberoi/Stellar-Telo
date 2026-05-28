'use client';

import { useEffect, useMemo, useRef, useState, useActionState } from 'react';
import { useRouter } from 'next/navigation';
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
    nobleLogoPosition: 'left' | 'right';
    nobleLogoVisible: boolean;
    customLogoVisible: boolean;
    preparedBy: string | null;
  } | null;
}

const initial: InvoiceConfigState = { error: null, ok: false };

function ConfigForm({ row, onClose }: { row: MccRow; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveInvoiceConfigAction, initial);
  const [removeLogo, setRemoveLogo] = useState(false);
  const hasLogo = row.config?.hasTopRightLogo ?? false;
  const isMedicareDefault =
    MEDICARE_MCC_CODES.has(row.mccCode.trim().toLowerCase()) && !hasLogo;

  // Layout state — defaults match the SQL fall-back (left, both visible).
  // The parent re-mounts this component (via a `key` derived from
  // row.config) whenever the saved config changes, so these useState
  // initializers are guaranteed to see the freshest server snapshot. That's
  // why no useEffect resync is needed here.
  const [noblePosition, setNoblePosition] = useState<'left' | 'right'>(
    row.config?.nobleLogoPosition ?? 'left',
  );
  const [nobleVisible, setNobleVisible] = useState<boolean>(
    row.config?.nobleLogoVisible ?? true,
  );
  const [customVisible, setCustomVisible] = useState<boolean>(
    row.config?.customLogoVisible ?? true,
  );

  // Force the client to re-fetch /admin/invoice after a successful save.
  // `revalidatePath` inside the server action invalidates the server cache,
  // but in this useActionState + form combo it doesn't always trigger an
  // automatic client transition. `router.refresh()` makes it explicit, and
  // the resulting new `row.config` flows down to the parent, which then
  // remounts this form via its config-derived key. Net effect: the form
  // always reflects what's actually in the database after a save.
  const lastOkRef = useRef(state.ok);
  useEffect(() => {
    if (state.ok && !lastOkRef.current) {
      router.refresh();
    }
    lastOkRef.current = state.ok;
  }, [state.ok, router]);

  const customPosition: 'left' | 'right' = noblePosition === 'left' ? 'right' : 'left';

  return (
    <form action={action} encType="multipart/form-data" className="space-y-3 pt-2">
      <input type="hidden" name="mccId" value={row.mccId} />
      {removeLogo && <input type="hidden" name="removeLogo" value="1" />}
      {/* Layout fields are always submitted so the server can persist toggles. */}
      <input type="hidden" name="layoutSubmitted" value="1" />
      <input type="hidden" name="nobleLogoPosition" value={noblePosition} />
      {nobleVisible && <input type="hidden" name="nobleLogoVisible" value="1" />}
      {customVisible && <input type="hidden" name="customLogoVisible" value="1" />}
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
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`pb-${row.mccId}`}>Prepared by (receptionist name)</Label>
          <Input
            id={`pb-${row.mccId}`}
            name="preparedBy"
            placeholder="e.g. Priya Sharma"
            defaultValue={row.config?.preparedBy ?? ''}
            maxLength={120}
          />
          <p className="text-xs text-muted-foreground">
            Printed above the &ldquo;Note:&rdquo; block on the bill as
            &ldquo;Prepared By: &lt;name&gt;&rdquo;. Leave blank to hide.
          </p>
        </div>
        <div className="space-y-2 sm:col-span-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <Label className="block">Header layout</Label>
          <p className="text-xs text-muted-foreground">
            Choose where the Noble logo sits — the custom logo (if uploaded, or
            the built-in Medicare logo for{' '}
            <span className="font-mono">medicare_test</span> /{' '}
            <span className="font-mono">medicare_tech</span>) automatically sits
            on the opposite side. Hide either logo with the toggles.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor={`pos-${row.mccId}`} className="text-xs">
                Noble position
              </Label>
              <select
                id={`pos-${row.mccId}`}
                value={noblePosition}
                onChange={(e) => setNoblePosition(e.target.value as 'left' | 'right')}
                className="h-8 w-full rounded-md border border-white/10 bg-transparent px-2 text-sm"
              >
                <option value="left">Top left</option>
                <option value="right">Top right</option>
              </select>
              <p className="text-[10px] text-muted-foreground">
                Custom logo will be on the {customPosition === 'left' ? 'top left' : 'top right'}.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-white/10 p-2">
              <input
                type="checkbox"
                checked={nobleVisible}
                onChange={(e) => setNobleVisible(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="block font-medium">Show Noble logo</span>
                <span className="text-muted-foreground">
                  Hide on bills for this client account.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-white/10 p-2">
              <input
                type="checkbox"
                checked={customVisible}
                onChange={(e) => setCustomVisible(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="block font-medium">Show custom logo</span>
                <span className="text-muted-foreground">
                  Applies to uploaded logo or the built-in Medicare logo.
                </span>
              </span>
            </label>
          </div>
        </div>
        <div className="space-y-2 sm:col-span-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <Label htmlFor={`logo-${row.mccId}`}>Custom logo (optional)</Label>
          <p className="text-xs text-muted-foreground">
            Shown opposite the Noble logo on every bill — exact placement
            controlled by the header layout above. Stored in Telo only.
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
  if (!c) return false;
  if (c.labName || c.address || c.phone || c.email || c.hasTopRightLogo || c.preparedBy) return true;
  // Layout customisation also counts as "configured".
  if (c.nobleLogoPosition === 'right') return true;
  if (!c.nobleLogoVisible) return true;
  if (!c.customLogoVisible) return true;
  return false;
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
                  // Key derived from the saved layout fields: when a save
                  // changes any of them server-side, this changes too, which
                  // forces ConfigForm to unmount + remount. That makes its
                  // useState initializers run again against the new
                  // row.config, so the form's displayed state always matches
                  // the database — sidestepping React 19's form-reset
                  // desync of controlled inputs after useActionState.
                  <ConfigForm
                    key={`cfg-${row.mccId}-${row.config?.nobleLogoPosition ?? 'left'}-${row.config?.nobleLogoVisible ?? true ? 1 : 0}-${row.config?.customLogoVisible ?? true ? 1 : 0}-${row.config?.hasTopRightLogo ? 1 : 0}`}
                    row={row}
                    onClose={() => setEditing(null)}
                  />
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
