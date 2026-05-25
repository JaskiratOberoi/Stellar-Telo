'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  submitSids,
  type AccessionState,
  type AccessionGroup,
} from '@/actions/accession.actions';
import { SidField, type SidStatus } from '@/components/register/sid-field';
import { Button } from '@/components/ui/button';

const initial: AccessionState = { error: null };

/**
 * Lab-technician accessioning form: one SID input per sample type still
 * missing one; already-accessioned types are shown locked. Patient details and
 * tests are rendered read-only by the page — only SIDs are editable here.
 */
export function AccessionForm({
  billId,
  groups,
}: {
  billId: number;
  groups: AccessionGroup[];
}) {
  // Render client-only — browser form-fillers mutate SSR HTML pre-hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [state, action, pending] = useActionState(submitSids, initial);

  const [sids, setSids] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<Record<number, SidStatus>>({});

  if (!mounted) {
    return <div className="h-40 animate-pulse rounded-xl border bg-muted/40" />;
  }

  const pendingGroups = groups.filter((g) => g.existingSid == null);

  const trimmed = pendingGroups.map((g) => (sids[g.sampleTypeId] ?? '').trim());
  const filled = trimmed.filter((v) => v.length > 0);
  const anyTaken = pendingGroups.some(
    (g) => status[g.sampleTypeId] === 'taken',
  );
  const anyChecking = pendingGroups.some(
    (g) => status[g.sampleTypeId] === 'checking',
  );
  const hasClientDup =
    new Set(filled).size < filled.length;
  const blocked =
    pending || filled.length === 0 || anyTaken || anyChecking || hasClientDup;

  const sidsJson = JSON.stringify(
    pendingGroups
      .map((g) => ({
        sampleTypeId: g.sampleTypeId,
        vailid: (sids[g.sampleTypeId] ?? '').trim(),
      }))
      .filter((s) => s.vailid !== ''),
  );

  const label = pending
    ? 'Saving…'
    : filled.length === 0
      ? 'Enter a Sample ID'
      : anyTaken
        ? 'Sample ID already exists'
        : hasClientDup
          ? 'Duplicate Sample IDs'
          : anyChecking
            ? 'Checking…'
            : `Save ${filled.length} Sample ID${filled.length === 1 ? '' : 's'}`;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="billId" value={billId} />
      <input type="hidden" name="sidsJson" value={sidsJson} />

      <p className="text-xs text-muted-foreground">
        Enter the barcodes you have — any left blank can be accessioned later.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {groups.map((g) => {
          const locked = g.existingSid != null;
          const me = (sids[g.sampleTypeId] ?? '').trim();
          const clientDup =
            !locked && !!me && trimmed.filter((v) => v === me).length > 1;
          return (
            <SidField
              key={g.sampleTypeId}
              group={g}
              locked={locked}
              value={locked ? (g.existingSid ?? '') : (sids[g.sampleTypeId] ?? '')}
              onChange={(next) =>
                setSids((p) => ({ ...p, [g.sampleTypeId]: next }))
              }
              status={status[g.sampleTypeId] ?? 'idle'}
              onStatus={(s) =>
                setStatus((p) => ({ ...p, [g.sampleTypeId]: s }))
              }
              clientDup={clientDup}
            />
          );
        })}
      </div>

      {state.error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={blocked}>
        {label}
      </Button>
    </form>
  );
}
