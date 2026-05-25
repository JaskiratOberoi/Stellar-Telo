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
      className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
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
