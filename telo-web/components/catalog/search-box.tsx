'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';

/**
 * Debounced catalog search. Pushes `?q=` to the URL; the server component
 * re-renders the filtered list (catalog itself is redis-cached, so this is
 * an in-memory filter on the server — no DB round-trip per keystroke).
 */
export function CatalogSearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = new URLSearchParams(Array.from(params.entries()));
      if (value) next.set('q', value);
      else next.delete('q');
      startTransition(() => router.replace(`/catalog?${next.toString()}`));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      placeholder="Search tests or profiles by name or code…"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className="max-w-md"
      autoFocus
    />
  );
}
