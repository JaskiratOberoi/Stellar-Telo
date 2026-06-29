'use client';

import { useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface ComboItem {
  id: number;
  code: string;
  name: string | null;
}

/**
 * Lightweight typeahead combobox for large lists (e.g. 1.7k client codes)
 * where a native <select> is unusable. Filters by code or name; the chosen
 * numeric id is exposed via onChange (and a hidden input by the parent).
 */
export function Combobox({
  items,
  value,
  onChange,
  placeholder = 'Type code or name…',
  id,
  disabled = false,
}: {
  items: ComboItem[];
  value: number | '';
  onChange: (id: number | '') => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}) {
  const selected = useMemo(
    () => (value === '' ? null : items.find((i) => i.id === value) ?? null),
    [items, value],
  );
  const label = (i: ComboItem) =>
    `${i.name ?? i.code}${i.code ? ` (${i.code})` : ''}`;

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items
      .filter(
        (i) =>
          i.code.toLowerCase().includes(q) ||
          (i.name ?? '').toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [items, query]);

  const display = open ? query : selected ? label(selected) : '';

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
          'flex h-9 w-full rounded-md border border-foreground/10 bg-input px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/60',
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
            setHi((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && open && filtered[hi]) {
            e.preventDefault();
            pick(filtered[hi]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-foreground/10 bg-card shadow-xl">
          {filtered.map((i, idx) => (
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
                  idx === hi ? 'bg-foreground/10' : 'hover:bg-foreground/5',
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
      {open && query.trim() && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-foreground/10 bg-card px-3 py-2 text-sm text-muted-foreground shadow-xl">
          No match
        </div>
      )}
    </div>
  );
}
