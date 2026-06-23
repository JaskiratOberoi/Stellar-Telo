'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { MccPeriod } from '@/components/balances/mcc-balance-filters';
import type { ScopedClient, ScopedMcc } from '@/db/read/mccUnits';
import type { AccountTypeFilter } from '@/db/read/mccLedger';
import { searchClientsInScope } from '@/actions/clientPicker.actions';

/**
 * Client-Accounts filter bar — mirrors the LIS Mcc_Account top bar:
 *   [Business Unit] [Client] [From] [To] [presets] [Payment Type]
 *
 * - Business Unit narrows the Client switcher (same role as the LIS
 *   "Select Business Unit"). Only shown in scoped-select mode.
 * - Client switches the viewed centre inline (scoped → <select>; unrestricted
 *   Super Admin → debounced search, so we never ship ~1.7k options).
 * - Payment Type is the LIS "Choose Type" — filters the transaction grid.
 *
 * All controls do a full browser navigation (window.location.assign) for the
 * force-dynamic reason documented in components/balances/mcc-balance-filters.tsx.
 */
const TYPE_OPTIONS: { value: '' | AccountTypeFilter; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'payment', label: 'Payment' },
  { value: 'credit', label: 'Credit' },
  { value: 'debit', label: 'Debit' },
];

export function ClientAccountFilters({
  mccId,
  from,
  to,
  type,
  periods,
  activeLabel,
  maxDate,
  clients,
  showClientSwitcher = true,
}: {
  mccId: number;
  from: string;
  to: string;
  type: AccountTypeFilter | null;
  periods: MccPeriod[];
  activeLabel: string | null;
  maxDate: string;
  /** Scoped client list (≤1000) → select mode. Undefined → unrestricted search. */
  clients?: ScopedClient[];
  /** Hide the client/BU switcher for single-centre (locked) users. */
  showClientSwitcher?: boolean;
}) {
  const [fromLocal, setFromLocal] = useState(from);
  const [toLocal, setToLocal] = useState(to);
  const [navigating, setNavigating] = useState(false);
  useEffect(() => setFromLocal(from), [from]);
  useEffect(() => setToLocal(to), [to]);

  const href = (id: number, f: string, t: string, ty: '' | AccountTypeFilter) => {
    const lo = f <= t ? f : t;
    const hi = f <= t ? t : f;
    return `/client-accounts/${id}?from=${lo}&to=${hi}${ty ? `&type=${ty}` : ''}`;
  };
  const goto = (url: string) => {
    setNavigating(true);
    window.location.assign(url);
  };
  const typeValue: '' | AccountTypeFilter = type ?? '';

  // ── Business Unit narrowing (scoped-select mode only) ──────────────────────
  const [buFilter, setBuFilter] = useState<number | ''>('');
  const buOptions = clients
    ? Array.from(
        new Map(
          clients
            .filter((c) => c.buId != null)
            .map((c) => [c.buId as number, c.buName ?? `BU ${c.buId}`]),
        ).entries(),
      ).sort((a, b) => a[1].localeCompare(b[1]))
    : [];
  const clientOptions = (clients ?? []).filter(
    (c) => buFilter === '' || c.buId === buFilter,
  );
  const clientSelectValue = clientOptions.some((c) => c.id === mccId)
    ? String(mccId)
    : '';

  return (
    <div className="flex flex-wrap items-end gap-2">
      {showClientSwitcher && clients && buOptions.length > 1 && (
        <div className="space-y-0.5">
          <label className="text-xs text-muted-foreground">Business Unit</label>
          <select
            value={buFilter === '' ? '' : String(buFilter)}
            onChange={(e) =>
              setBuFilter(e.target.value === '' ? '' : Number(e.target.value))
            }
            disabled={navigating}
            suppressHydrationWarning
            className="h-8 w-full sm:w-44 rounded-md border border-white/10 bg-input px-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/60"
          >
            <option value="">All units</option>
            {buOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {showClientSwitcher &&
        (clients ? (
          <div className="space-y-0.5">
            <label className="text-xs text-muted-foreground">Client</label>
            <select
              value={clientSelectValue}
              onChange={(e) => {
                if (e.target.value)
                  goto(href(Number(e.target.value), from, to, typeValue));
              }}
              disabled={navigating}
              suppressHydrationWarning
              className="h-8 w-full sm:w-64 rounded-md border border-white/10 bg-input px-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/60"
            >
              {clientSelectValue === '' && (
                <option value="">Select a client…</option>
              )}
              {clientOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                  {c.name ? ` · ${c.name}` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <ClientSearch
            onPick={(id) => goto(href(id, from, to, typeValue))}
            disabled={navigating}
          />
        ))}

      <div className="space-y-0.5">
        <label className="text-xs text-muted-foreground">From</label>
        <Input
          type="date"
          value={fromLocal}
          max={toLocal || maxDate}
          disabled={navigating}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            setFromLocal(v);
            goto(href(mccId, v, toLocal, typeValue));
          }}
          className="h-8 w-full sm:w-40"
        />
      </div>
      <div className="space-y-0.5">
        <label className="text-xs text-muted-foreground">To</label>
        <Input
          type="date"
          value={toLocal}
          min={fromLocal}
          max={maxDate}
          disabled={navigating}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            setToLocal(v);
            goto(href(mccId, fromLocal, v, typeValue));
          }}
          className="h-8 w-full sm:w-40"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 self-end rounded-lg border border-white/5 bg-card p-1">
        {periods.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={navigating}
            onClick={() => goto(href(mccId, p.from, p.to, typeValue))}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-all duration-150',
              p.label === activeLabel
                ? 'bg-primary/20 text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
              navigating && 'cursor-wait opacity-70',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="space-y-0.5">
        <label className="text-xs text-muted-foreground">Payment Type</label>
        <select
          value={typeValue}
          onChange={(e) =>
            goto(href(mccId, from, to, e.target.value as '' | AccountTypeFilter))
          }
          disabled={navigating}
          suppressHydrationWarning
          className="h-8 w-36 rounded-md border border-white/10 bg-input px-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/60"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Debounced client search (unrestricted Super Admin) — same UX as the index
 *  picker but the caller wires navigation so it can carry from/to/type. */
function ClientSearch({
  onPick,
  disabled,
}: {
  onPick: (id: number) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ScopedMcc[]>([]);
  const [pending, startTransition] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      const mine = ++seq.current;
      startTransition(async () => {
        const res = await searchClientsInScope(needle);
        if (mine === seq.current) setResults(res);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-0.5">
      <label className="text-xs text-muted-foreground">Client</label>
      <div className="relative w-full sm:w-64">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Switch client…"
          disabled={disabled}
          suppressHydrationWarning
          className="h-8 w-full sm:w-64 rounded-md border border-white/10 bg-input px-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/60"
        />
        {q.trim() && (
          <div className="absolute z-20 mt-1 max-h-72 w-full sm:w-64 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border border-white/10 bg-card shadow-lg">
            {pending && results.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No matches.</p>
            ) : (
              results.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onPick(m.id)}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-white/5"
                >
                  <span className="font-mono">{m.code}</span>
                  {m.name && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      · {m.name}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
