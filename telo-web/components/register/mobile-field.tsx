'use client';

import { useEffect, useRef, useState } from 'react';
import { checkMobileUsage } from '@/actions/register.actions';
import { MAX_PATIENTS_PER_MOBILE } from '@/lib/limits';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type MobileStatus = 'idle' | 'checking' | 'ok' | 'blocked' | 'error';

/**
 * The New Order form's Mobile input with a live per-number usage meter.
 * A mobile number may belong to at most MAX_PATIENTS_PER_MOBILE Telo
 * patients; while the receptionist types, this runs a debounced count
 * against Noble and reports status up so the form can block the submit at
 * the limit. Same debounce + stale-sequence shape as SidField. The check is
 * advisory — registerOrder and usp_telo_create_order re-enforce it on save.
 */
export function MobileField({
  value,
  onChange,
  status,
  onStatus,
}: {
  value: string;
  onChange: (next: string) => void;
  status: MobileStatus;
  onStatus: (s: MobileStatus) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const v = (value ?? '').trim();
    if (timer.current) clearTimeout(timer.current);
    // Below the form's 10-char minimum the number can't be saved anyway, so
    // don't burn a lookup per keystroke on partial input.
    if (v.length < 10) {
      onStatus('idle');
      setCount(0);
      return;
    }
    onStatus('checking');
    const my = ++seq.current;
    timer.current = setTimeout(async () => {
      try {
        const r = await checkMobileUsage(v);
        if (my !== seq.current) return;
        setCount(r.count);
        // 'empty'/'error' must NOT fall through to a green state — an
        // unverified number at the cap would otherwise read as usable.
        onStatus(
          r.status === 'blocked' ? 'blocked' : r.status === 'ok' ? 'ok' : 'error',
        );
      } catch {
        if (my === seq.current) onStatus('error');
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const bad = status === 'blocked' || status === 'error';
  const remaining = Math.max(0, MAX_PATIENTS_PER_MOBILE - count);
  return (
    <div className="space-y-0.5">
      <Label htmlFor="mobile">Mobile *</Label>
      <Input
        id="mobile"
        name="mobile"
        required
        inputMode="tel"
        minLength={10}
        maxLength={20}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={
          bad
            ? 'border-destructive/60 focus-visible:ring-destructive/60'
            : undefined
        }
        aria-invalid={bad}
      />
      {status === 'checking' && (
        <p className="text-xs text-muted-foreground">Checking usage…</p>
      )}
      {status === 'ok' && count === 0 && (
        <p className="animate-fade-in text-xs font-medium text-success motion-reduce:animate-none">
          ✓ Not used before
        </p>
      )}
      {status === 'ok' && count > 0 && (
        <p className="text-xs text-warning">
          Used by {count} patient{count === 1 ? '' : 's'} before — {remaining}{' '}
          more allowed.
        </p>
      )}
      {status === 'blocked' && (
        <p className="animate-shake text-xs text-destructive motion-reduce:animate-none">
          ✗ Already used by {count} patients — the limit is{' '}
          {MAX_PATIENTS_PER_MOBILE} patients per mobile number.
        </p>
      )}
      {status === 'error' && (
        <p className="animate-shake text-xs text-destructive motion-reduce:animate-none">
          ✗ Couldn&apos;t verify this number — try again before saving.
        </p>
      )}
    </div>
  );
}
