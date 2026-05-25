'use client';

import { useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ComboItem } from '@/components/ui/combobox';

export type CreatableValue =
  | { kind: 'existing'; id: number }
  | { kind: 'new'; name: string }
  | null;

/**
 * Combobox with a "+ Add new" affordance. Used for Ref. doctor / Ref. customer
 * inputs in the new-order form where the operator's referrer may not yet exist
 * in the LIS master. The structured value lets the caller pass either an id
 * (existing match) or a fresh name (new entry) to the order SP; the SP upserts
 * inside the order transaction.
 */
export function CreatableCombobox({
  items,
  value,
  onChange,
  placeholder = 'Type to search or add new…',
  id,
  disabled = false,
}: {
  items: ComboItem[];
  value: CreatableValue;
  onChange: (v: CreatableValue) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}) {
  const selected = useMemo(() => {
    if (value?.kind === 'existing') {
      return items.find((i) => i.id === value.id) ?? null;
    }
    return null;
  }, [items, value]);

  const labelExisting = (i: ComboItem) =>
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

  const trimmedQuery = query.trim();
  const exactMatch = useMemo(() => {
    if (!trimmedQuery) return null;
    const q = trimmedQuery.toLowerCase();
    return items.find((i) => (i.name ?? '').toLowerCase() === q) ?? null;
  }, [items, trimmedQuery]);

  const showAddNew = open && trimmedQuery.length > 0 && !exactMatch;

  const display = open
    ? query
    : selected
      ? labelExisting(selected)
      : value?.kind === 'new'
        ? `${value.name} (new)`
        : '';

  function pickExisting(i: ComboItem) {
    onChange({ kind: 'existing', id: i.id });
    setQuery('');
    setOpen(false);
  }
  function pickNew(name: string) {
    onChange({ kind: 'new', name: name.trim() });
    setQuery('');
    setOpen(false);
  }

  // Highlight index navigates both existing rows and (when shown) the add-new row.
  const totalRows = filtered.length + (showAddNew ? 1 : 0);
  const addNewIdx = filtered.length;

  return (
    <div className="relative">
      <input
        id={id}
        suppressHydrationWarning
        autoComplete="off"
        disabled={disabled}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          disabled && 'cursor-not-allowed bg-muted/40 text-muted-foreground',
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
          if (e.target.value === '') onChange(null);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, totalRows - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            if (showAddNew && hi === addNewIdx) {
              pickNew(trimmedQuery);
            } else if (filtered[hi]) {
              pickExisting(filtered[hi]);
            } else if (showAddNew) {
              // typed something but nothing matched + arrow keys not used →
              // Enter commits the new name.
              pickNew(trimmedQuery);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && (filtered.length > 0 || showAddNew) && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-background shadow-md">
          {filtered.map((i, idx) => (
            <li key={i.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  pickExisting(i);
                }}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                  idx === hi ? 'bg-accent' : 'hover:bg-accent',
                )}
              >
                <span>{i.name ?? i.code}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {i.code}
                </span>
              </button>
            </li>
          ))}
          {showAddNew && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  pickNew(trimmedQuery);
                }}
                className={cn(
                  'flex w-full items-center justify-between border-t px-3 py-2 text-left text-sm',
                  addNewIdx === hi ? 'bg-accent' : 'hover:bg-accent',
                )}
              >
                <span>
                  <span className="text-muted-foreground">+ Add new</span>{' '}
                  <span className="font-medium">&ldquo;{trimmedQuery}&rdquo;</span>
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  New
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
