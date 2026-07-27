'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SuggestOption {
  /** The value committed to the field when this option is picked. */
  value: string;
  /** Primary label shown in the dropdown row. */
  label: string;
  /** Optional secondary hint (e.g. the code), shown right-aligned & monospaced. */
  hint?: string;
}

/**
 * Server-search autosuggest for a STRING-valued field (unlike RemoteCombobox,
 * which is keyed by a numeric id). Built for FILTER inputs: the typed text *is*
 * the value, so a user can free-type a code and search even without picking a
 * suggestion; picking a row simply autocompletes the field to that value.
 *
 * `search` is called with a debounced query and returns ≤N rows to render.
 */
export function SuggestInput({
  value,
  onChange,
  search,
  placeholder,
  disabled = false,
  readOnly = false,
  className,
  title,
  id,
  debounceMs = 200,
}: {
  value: string;
  onChange: (value: string) => void;
  search: (query: string) => Promise<SuggestOption[]>;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  title?: string;
  id?: string;
  debounceMs?: number;
}) {
  const [items, setItems] = useState<SuggestOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest-fetch guard so a slow response can't overwrite a newer one.
  const fetchSeq = useRef(0);
  // Keep `search` in a ref: callers pass a fresh closure each render, and we
  // don't want that to refire the effect (see RemoteCombobox for the rationale).
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  const inert = disabled || readOnly;

  useEffect(() => {
    if (!open || inert) return;
    const seq = ++fetchSeq.current;
    setLoading(true);
    const t = setTimeout(() => {
      searchRef
        .current(value)
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
  }, [value, open, inert, debounceMs]);

  function pick(o: SuggestOption) {
    onChange(o.value);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        id={id}
        suppressHydrationWarning
        autoComplete="off"
        disabled={disabled}
        readOnly={readOnly}
        title={title}
        className={cn(
          'flex h-9 w-full rounded-md border border-foreground/10 bg-input px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/60',
          disabled && 'cursor-not-allowed opacity-50 text-muted-foreground',
          className,
        )}
        placeholder={placeholder}
        value={value}
        onFocus={() => {
          if (inert) return;
          setOpen(true);
          setHi(0);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onChange={(e) => {
          if (inert) return;
          onChange(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (inert) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHi((h) => Math.min(h + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && open && items[hi]) {
            // Pick the highlighted suggestion; don't submit the form yet.
            e.preventDefault();
            pick(items[hi]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && !inert && (items.length > 0 || loading) && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-foreground/10 bg-card shadow-xl">
          {loading && items.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>
          )}
          {items.map((o, idx) => (
            <li key={`${o.value}-${idx}`}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  pick(o);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm',
                  idx === hi ? 'bg-foreground/10' : 'hover:bg-foreground/5',
                )}
              >
                <span className="truncate">{o.label}</span>
                {o.hint && (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {o.hint}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !inert && !loading && value.trim() && items.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-foreground/10 bg-card px-3 py-2 text-sm text-muted-foreground shadow-xl">
          No match
        </div>
      )}
    </div>
  );
}
