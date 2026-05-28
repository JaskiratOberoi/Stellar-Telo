'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ComboItem } from './combobox';

/**
 * Server-search combobox for very large lists (e.g. ~1.7k MCC client codes)
 * where shipping the whole list to the browser is wasteful. Calls `search`
 * with a debounced query and renders the returned ≤50 rows.
 *
 * Unlike the in-memory <Combobox>, this component never holds the full
 * dataset — selection by id is supported by the parent passing `value` and a
 * `getSelectedLabel(id)` resolver (typically backed by the picked-chip cache).
 */
export function RemoteCombobox({
  search,
  value,
  onChange,
  getSelectedLabel,
  placeholder = 'Type code or name…',
  id,
  disabled = false,
  debounceMs = 200,
}: {
  search: (query: string) => Promise<ComboItem[]>;
  value: number | '';
  onChange: (id: number | '') => void;
  getSelectedLabel?: (id: number) => string | undefined;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  debounceMs?: number;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ComboItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the latest fetch generation so a stale response can't overwrite
  // a newer one (typeahead races are the most common bug class here).
  const fetchSeq = useRef(0);
  // Keep `search` in a ref so we don't refire the effect just because the
  // parent re-rendered with a new function reference. Callers commonly do
  // `search={(q) => fooAction(q, deps)}` which creates a brand-new closure
  // every render — if we listed it as a hook dep, the effect would re-fire
  // → call .then which setStates → parent rerenders → new fn ref → loop.
  // The ref always points at the latest closure, so the most recent deps
  // (pickedMccIds etc.) are still respected when the search actually runs.
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useEffect(() => {
    if (!open) return;
    const seq = ++fetchSeq.current;
    setLoading(true);
    const t = setTimeout(() => {
      searchRef
        .current(query)
        .then((rows) => {
          if (fetchSeq.current !== seq) return;
          setItems(rows);
        })
        .catch(() => {
          if (fetchSeq.current !== seq) return;
          setItems([]);
        })
        .finally(() => {
          if (fetchSeq.current === seq) setLoading(false);
        });
    }, debounceMs);
    return () => clearTimeout(t);
  }, [query, open, debounceMs]);

  const selectedLabel = useMemo(
    () => (value === '' ? '' : getSelectedLabel?.(value) ?? ''),
    [value, getSelectedLabel],
  );
  const display = open ? query : selectedLabel;

  function pick(i: ComboItem) {
    onChange(i.id);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        id={id}
        suppressHydrationWarning
        autoComplete="off"
        disabled={disabled}
        className={cn(
          'flex h-9 w-full rounded-md border border-white/10 bg-input px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/60',
          disabled && 'cursor-not-allowed opacity-50 text-muted-foreground',
        )}
        placeholder={placeholder}
        value={display}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          setQuery('');
          setHi(0);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onChange={(e) => {
          if (disabled) return;
          setQuery(e.target.value);
          setOpen(true);
          setHi(0);
          if (e.target.value === '') onChange('');
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && open && items[hi]) {
            e.preventDefault();
            pick(items[hi]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && (items.length > 0 || loading) && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-white/10 bg-card shadow-xl">
          {loading && items.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              Searching…
            </li>
          )}
          {items.map((i, idx) => (
            <li key={i.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  pick(i);
                }}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                  idx === hi ? 'bg-white/10' : 'hover:bg-white/5',
                )}
              >
                <span>{i.name ?? i.code}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {i.code}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && query.trim() && items.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-white/10 bg-card px-3 py-2 text-sm text-muted-foreground shadow-xl">
          No match
        </div>
      )}
    </div>
  );
}
