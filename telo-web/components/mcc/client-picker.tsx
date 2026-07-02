'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { searchClientsInScope } from '@/actions/clientPicker.actions';
import type { ScopedMcc } from '@/db/read/mccUnits';

/**
 * Pick a client (MCC) to view, then navigate to `${basePath}/${id}` carrying
 * the date range. Two modes:
 *
 *  - `options` provided (scoped users, ≤1000 centres) → a native <select>.
 *  - `options` omitted (unrestricted Super Admin / Admin) → a debounced search
 *    box backed by `searchClientsInScope`, so we never ship ~1.7k <option>s.
 *
 * Full browser navigation (window.location.assign) — the target pages are
 * force-dynamic (see components/balances/mcc-balance-filters.tsx for why).
 */
export function ClientPicker({
  basePath,
  from,
  to,
  options,
}: {
  basePath: string;
  from: string;
  to: string;
  options?: ScopedMcc[];
}) {
  const go = (id: number) =>
    window.location.assign(`${basePath}/${id}?from=${from}&to=${to}`);

  if (options && options.length > 0) {
    return (
      <div className="space-y-0.5">
        <label className="text-xs text-muted-foreground">Client</label>
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) go(Number(e.target.value));
          }}
          suppressHydrationWarning
          className="h-8 w-full sm:w-72 rounded-lg border border-border bg-input px-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/60"
        >
          <option value="">Select a client…</option>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code}
              {m.name ? ` · ${m.name}` : ''}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return <ClientSearch onPick={go} />;
}

function ClientSearch({ onPick }: { onPick: (id: number) => void }) {
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
      <div className="relative w-full sm:w-72">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search code or name…"
          suppressHydrationWarning
          className="h-8 w-full sm:w-72 rounded-lg border border-border bg-input px-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/60"
        />
        {q.trim() && (
          <div className="absolute z-20 mt-1 max-h-72 w-full sm:w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-border bg-popover shadow-elevation-3 animate-scale-in motion-reduce:animate-none">
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
                  className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:outline-none"
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
