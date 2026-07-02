'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setCartMcc } from '@/actions/cart.actions';
import type { ScopedMcc } from '@/db/read/mccUnits';

export function MccSelector({
  units,
  selected,
}: {
  units: ScopedMcc[];
  selected: number | null;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <select
      suppressHydrationWarning
      aria-label="Collection centre"
      className="h-9 max-w-[18rem] rounded-md border border-border bg-input px-3 text-sm text-foreground shadow-elevation-1 transition-[border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50"
      defaultValue={selected ?? ''}
      disabled={pending}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!v) return;
        start(async () => {
          await setCartMcc(v);
          router.refresh();
        });
      }}
    >
      <option value="" disabled>
        Select collection centre…
      </option>
      {units.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name ?? u.code} ({u.code})
        </option>
      ))}
    </select>
  );
}
