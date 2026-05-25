'use client';

import { useEffect, useRef } from 'react';
import { checkSid } from '@/actions/register.actions';
import type { SampleGroup } from '@/db/sp/previewSampleGroups';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type SidStatus = 'idle' | 'checking' | 'available' | 'taken';

/**
 * One labeled Sample ID input — used once per distinct sample type an order
 * requires. Runs its own debounced existence check against Noble and reports
 * status up. Shared by the New Order form and the accession page.
 */
export function SidField({
  group,
  value,
  onChange,
  status,
  onStatus,
  clientDup,
  locked = false,
}: {
  group: SampleGroup;
  value: string;
  onChange: (next: string) => void;
  status: SidStatus;
  onStatus: (s: SidStatus) => void;
  clientDup: boolean;
  /** Already accessioned — show the SID read-only, no checks. */
  locked?: boolean;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (locked) return;
    const v = (value ?? '').trim();
    if (timer.current) clearTimeout(timer.current);
    if (!v) {
      onStatus('idle');
      return;
    }
    onStatus('checking');
    const my = ++seq.current;
    timer.current = setTimeout(async () => {
      try {
        const r = await checkSid(v);
        if (my !== seq.current) return;
        onStatus(r.status === 'taken' ? 'taken' : 'available');
      } catch {
        if (my === seq.current) onStatus('idle');
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, locked]);

  const bad = !locked && (status === 'taken' || clientDup);
  const ok = locked || (status === 'available' && !clientDup);
  return (
    <div className="space-y-1 rounded-md border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-sm font-medium">
          {group.sampleTypeName}
          {group.sampleTypeId === -1 && (
            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700">
              unspecified
            </span>
          )}
          {group.requiresSplit && (
            <span className="ml-2 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-blue-700">
              split
            </span>
          )}
          {locked && (
            <span className="ml-2 rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-green-700">
              accessioned
            </span>
          )}
        </Label>
        <span className="font-mono text-xs text-muted-foreground">
          {group.csvCodes}
        </span>
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Scan/enter SID for ${group.sampleTypeName}`}
        maxLength={50}
        disabled={locked}
        readOnly={locked}
        className={
          bad
            ? 'border-destructive focus-visible:ring-destructive'
            : ok
              ? 'border-green-600 focus-visible:ring-green-600'
              : undefined
        }
        aria-invalid={bad}
      />
      {!locked && status === 'checking' && (
        <p className="text-xs text-muted-foreground">Checking…</p>
      )}
      {!locked && status === 'available' && !clientDup && (
        <p className="text-xs text-green-600">✓ Available</p>
      )}
      {!locked && status === 'taken' && !clientDup && (
        <p className="text-xs text-destructive">
          ✗ This Sample ID already exists in Noble — use a different one.
        </p>
      )}
      {!locked && clientDup && (
        <p className="text-xs text-destructive">
          ✗ This Sample ID is also entered in another field above.
        </p>
      )}
    </div>
  );
}
