'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  createRateListAction,
  type CreateRateListState,
} from '@/actions/rateLists.actions';
import type { RateListSummary } from '@/db/read/rateLists';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const initial: CreateRateListState = { error: null };

export function RateListsBrowser({
  lists,
  canManage,
}: {
  lists: RateListSummary[];
  canManage: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    createRateListAction,
    initial,
  );

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return lists;
    return lists.filter((l) => l.name.toLowerCase().includes(n));
  }, [lists, q]);

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search rate lists by name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((l) => (
          <Link
            key={l.id}
            href={`/rate-lists/${l.id}`}
            className="flex items-center justify-between rounded-md border bg-card px-4 py-3 text-sm transition-colors hover:bg-accent"
          >
            <span className="font-medium">{l.name}</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {!l.isActive && (
                <span className="rounded bg-muted px-1.5 py-0.5">inactive</span>
              )}
              #{l.id} →
            </span>
          </Link>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">No rate lists match.</p>
        )}
      </div>

      {canManage && (
        <>
          {/* FAB */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Create rate list"
            className="fixed bottom-8 right-8 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-primary-foreground shadow-lg hover:opacity-90"
          >
            {open ? '×' : '+'}
          </button>

          {open && (
            <div className="fixed bottom-28 right-8 z-40 w-80">
              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base">New rate list</CardTitle>
                  <CardDescription className="text-xs">
                    Seeded from the default base rates — edit per-test after.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <form action={action} className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="name">Name (client / scheme)</Label>
                      <Input
                        id="name"
                        name="name"
                        required
                        maxLength={50}
                        placeholder="e.g. ACME HOSPITAL 2026"
                        autoFocus
                      />
                    </div>
                    {state.error && (
                      <p className="text-sm text-destructive">
                        {state.error}
                      </p>
                    )}
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={pending}
                    >
                      {pending ? 'Creating…' : 'Create & seed defaults'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
