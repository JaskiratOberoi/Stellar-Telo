'use client';

import { useEffect, useRef, useState } from 'react';
import { checkSid } from '@/actions/register.actions';
import type { SampleGroup } from '@/db/sp/previewSampleGroups';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Returns true if the string contains only digits (or is empty). */
function isNumericOnly(v: string) {
  return /^\d*$/.test(v);
}

export type SidStatus = 'idle' | 'checking' | 'available' | 'taken' | 'error';

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
  const [formatError, setFormatError] = useState(false);

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
        // Only an explicit 'taken'/'available' drives the badge. Anything else
        // ('error'/'empty') must NOT fall through to a green "available" —
        // that masked real duplicates when the lookup could not run.
        onStatus(
          r.status === 'taken'
            ? 'taken'
            : r.status === 'available'
              ? 'available'
              : 'error',
        );
      } catch {
        if (my === seq.current) onStatus('error');
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, locked]);

  const bad =
    !locked && (status === 'taken' || status === 'error' || clientDup || formatError);
  const ok = locked || (status === 'available' && !clientDup && !formatError);
  return (
    <div className="space-y-1 rounded-lg border border-foreground/5 bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-sm font-medium">
          {group.sampleTypeName}
          {group.sampleTypeId === -1 && (
            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-400">
              unspecified
            </span>
          )}
          {group.requiresSplit && (
            <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
              split
            </span>
          )}
          {locked && (
            <span className="ml-2 rounded bg-secondary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-secondary">
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
        onChange={(e) => {
          const raw = e.target.value;
          if (!isNumericOnly(raw)) {
            // Show error but don't propagate the invalid character.
            setFormatError(true);
            return;
          }
          setFormatError(false);
          onChange(raw);
        }}
        onPaste={(e) => {
          // Intercept pastes — strip non-digits rather than rejecting outright.
          e.preventDefault();
          const pasted = e.clipboardData.getData('text');
          const numeric = pasted.replace(/\D/g, '');
          const hadInvalid = numeric.length < pasted.trim().length;
          if (hadInvalid) setFormatError(true);
          else setFormatError(false);
          if (numeric) onChange(numeric);
        }}
        placeholder={`Scan/enter SID for ${group.sampleTypeName}`}
        inputMode="numeric"
        maxLength={50}
        disabled={locked}
        readOnly={locked}
        className={
          bad
            ? 'border-destructive/60 focus-visible:ring-destructive/60'
            : ok
              ? 'border-secondary/60 focus-visible:ring-secondary/60'
              : undefined
        }
        aria-invalid={bad}
      />
      {!locked && formatError && (
        <p className="text-xs text-destructive">
          ✗ Sample IDs must contain digits only — no letters or symbols.
        </p>
      )}
      {!locked && !formatError && status === 'checking' && (
        <p className="text-xs text-muted-foreground">Checking…</p>
      )}
      {!locked && !formatError && status === 'available' && !clientDup && (
        <p className="text-xs text-secondary">✓ Available</p>
      )}
      {!locked && !formatError && status === 'taken' && !clientDup && (
        <p className="text-xs text-destructive">
          ✗ This Sample ID already exists in Noble — use a different one.
        </p>
      )}
      {!locked && !formatError && status === 'error' && !clientDup && (
        <p className="text-xs text-destructive">
          ✗ Couldn&apos;t verify this Sample ID — try again before saving.
        </p>
      )}
      {!locked && !formatError && clientDup && (
        <p className="text-xs text-destructive">
          ✗ This Sample ID is also entered in another field above.
        </p>
      )}
    </div>
  );
}
