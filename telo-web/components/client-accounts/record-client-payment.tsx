'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  recordMccPaymentAction,
  type BillingAdminState,
} from '@/actions/billing-admin.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initial: BillingAdminState = { ok: false, error: null };

/** deposittype values, mirroring MccAccountClass.GetPaymentMode (LIS). */
const MODES: { value: number; label: string }[] = [
  { value: 3, label: 'Cash' },
  { value: 1, label: 'DD' },
  { value: 2, label: 'Cheque' },
  { value: 4, label: 'NEFT/Transfer' },
  { value: 5, label: 'Online' },
  { value: 6, label: 'Other' },
];

/**
 * SUPER-ADMIN-ONLY panel to post a manual client payment into the LIS
 * franchise-wallet ledger (same Save the LIS Mcc_Account screen performs). The
 * server action revalidates this page, so the balance + ledger update in place.
 */
export function RecordClientPayment({
  mccId,
  today,
}: {
  mccId: number;
  today: string; // 'YYYY-MM-DD' (IST) — default + max for the date picker
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    recordMccPaymentAction,
    initial,
  );
  const [mode, setMode] = useState(3);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);

  const showRef = mode !== 3; // a cash payment has no instrument reference

  // On a successful post: clear the form and collapse the panel. The page has
  // already revalidated server-side, so the new row/balance are visible behind.
  const prev = useRef(state);
  useEffect(() => {
    if (state !== prev.current && state.ok) {
      setAmount('');
      setMode(3);
      setDate(today);
      setOpen(false);
    }
    prev.current = state;
  }, [state, today]);

  const amountNum = Number(amount);
  const amountValid = Number.isInteger(amountNum) && amountNum > 0;

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => setOpen(true)}>
          Record payment
        </Button>
        {state.ok && (
          <span className="text-sm font-medium text-success animate-fade-in motion-reduce:animate-none">
            ✓ Payment recorded.
          </span>
        )}
      </div>
    );
  }

  return (
    <form
      action={action}
      className="space-y-3 rounded-xl border border-border/70 bg-card p-4 shadow-elevation-2 animate-scale-in motion-reduce:animate-none"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold tracking-tight">
          Record manual client payment
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md text-sm text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          Cancel
        </button>
      </div>

      <input type="hidden" name="mcc" value={mccId} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="rp-mode">Mode</Label>
          <select
            id="rp-mode"
            name="mode"
            value={mode}
            onChange={(e) => setMode(Number(e.target.value))}
            className="h-9 w-full rounded-lg border border-border bg-input px-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/60"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="rp-amount">Amount (₹)</Label>
          <Input
            id="rp-amount"
            name="amount"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={amount !== '' && !amountValid}
            placeholder="0"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="rp-date">Payment date</Label>
          <Input
            id="rp-date"
            name="depositDate"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="rp-ref">
            Cheque / DD / Ref No{' '}
            <span className="text-xs font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="rp-ref"
            name="chequeNo"
            maxLength={50}
            disabled={!showRef}
            placeholder={showRef ? 'Reference number' : '—'}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="rp-reason">
          Reason / note{' '}
          <span className="text-xs font-normal text-muted-foreground">
            (optional)
          </span>
        </Label>
        <Input
          id="rp-reason"
          name="reason"
          maxLength={200}
          placeholder="e.g. cash deposit at centre"
        />
      </div>

      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !amountValid}>
          {pending ? 'Recording…' : 'Record payment'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Posts to the shared LIS wallet — reconciles in Telo and the LIS.
        </span>
      </div>
    </form>
  );
}
