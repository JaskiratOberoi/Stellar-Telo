'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  recordOfflinePayment,
  type RecordPaymentState,
} from '@/actions/payment.actions';
import { PAY_METHODS, type PayMethod } from '@/lib/payment-methods';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronDown, Wallet } from 'lucide-react';

const initial: RecordPaymentState = { error: null, ok: false };

export function RecordPaymentForm({
  billId,
  balance,
}: {
  billId: number;
  balance: number;
}) {
  const [state, action, pending] = useActionState(
    recordOfflinePayment,
    initial,
  );
  const [method, setMethod] = useState<PayMethod>('Cash');
  // Controlled amount so we can: (a) cap on input, (b) gate the submit
  // button before the server-side check fires. balance is the absolute cap.
  const [amountInput, setAmountInput] = useState(String(balance));
  const showTxnRef = method !== 'Cash';

  // Keep the amount input in sync with the latest balance prop. After a
  // successful submit the parent revalidates and re-renders us with the new
  // (lower) balance — without this effect amountInput would still hold the
  // value the operator just submitted, looking like the input "didn't clear".
  useEffect(() => {
    setAmountInput(String(balance));
  }, [balance]);

  // React 19's <form action={…}> auto-resets the form's DOM after a
  // successful action. That clears uncontrolled inputs (txnRef) and visually
  // resets the <select> to its first option — but it does NOT fire onChange,
  // so our `method` state stays on e.g. 'UPI'. Result: the select shows
  // "Cash" while showTxnRef is still true and the UPI reference input keeps
  // rendering. Explicitly resync local state on every successful submit.
  const prevStateRef = useRef(state);
  useEffect(() => {
    if (state !== prevStateRef.current && state.ok) {
      setMethod('Cash');
    }
    prevStateRef.current = state;
  }, [state]);

  const amountNum = Number(amountInput);
  const isAmountValid =
    Number.isFinite(amountNum) && amountNum >= 1 && amountNum <= balance;
  const exceedsBalance = Number.isFinite(amountNum) && amountNum > balance;

  // Collapsible section — open by default (recording a payment is the most
  // common action on a bill with a balance). The header stays as a toggle so
  // the Summary card can be tidied away when the operator is only reading.
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md text-left text-sm font-medium text-zinc-900 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="flex items-center gap-1.5">
          <Wallet aria-hidden className="h-4 w-4" />
          Record offline payment
        </span>
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 text-zinc-400 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
    <form
      action={action}
      className="mt-2 animate-scale-in space-y-3 motion-reduce:animate-none"
    >
      <input type="hidden" name="billId" value={billId} />
      <div className="flex items-end gap-2">
        <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
          <div className="space-y-1 min-w-0">
            <Label htmlFor="method">Method</Label>
            <select
              id="method"
              name="method"
              suppressHydrationWarning
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
              value={method}
              onChange={(e) => setMethod(e.target.value as PayMethod)}
            >
              {PAY_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 min-w-0">
            <Label htmlFor="amount">Amount (₹)</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              inputMode="numeric"
              min={1}
              max={balance}
              value={amountInput}
              onChange={(e) => {
                // Cap at balance on input (paste-safe): if the user types a
                // larger value, clamp silently. Allow empty for editing.
                const raw = e.target.value;
                if (raw === '') {
                  setAmountInput('');
                  return;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                setAmountInput(n > balance ? String(balance) : raw);
              }}
              aria-invalid={!isAmountValid}
              className="w-full border-zinc-200 bg-white tabular-nums text-zinc-900 placeholder:text-zinc-400 focus-visible:border-primary"
            />
          </div>
        </div>
        <Button
          type="submit"
          disabled={pending || !isAmountValid}
          className="shrink-0"
        >
          {pending ? 'Recording…' : 'Record'}
        </Button>
      </div>
      {exceedsBalance && (
        <p className="animate-shake text-xs text-destructive motion-reduce:animate-none">
          ✗ Amount cannot exceed the outstanding balance of ₹
          {balance.toLocaleString('en-IN')}.
        </p>
      )}
      {showTxnRef && (
        <div className="space-y-1">
          <Label htmlFor="pay-txnRef" className="text-zinc-900">
            Transaction number{' '}
            <span className="text-xs font-normal text-zinc-500">(optional)</span>
          </Label>
          <Input
            id="pay-txnRef"
            name="txnRef"
            maxLength={100}
            placeholder={
              method === 'UPI'
                ? 'UPI reference / UTR'
                : method === 'Cheque'
                  ? 'Cheque number'
                  : method === 'Card'
                    ? 'Card auth / last 4 digits'
                    : `${method} reference`
            }
            className="border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 focus-visible:border-primary"
          />
        </div>
      )}
      {state.error && (
        <p className="animate-shake text-sm text-destructive motion-reduce:animate-none">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="animate-fade-in text-sm font-medium text-secondary motion-reduce:animate-none">
          ✓ Payment recorded.
        </p>
      )}
    </form>
      )}
    </div>
  );
}
