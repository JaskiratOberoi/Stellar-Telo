'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  recordRefundAction,
  type RecordPaymentState,
} from '@/actions/payment.actions';
import { PAY_METHODS, type PayMethod } from '@/lib/payment-methods';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initial: RecordPaymentState = { error: null, ok: false };

/**
 * Refund form — reverses part of a payment on an existing bill. The amount
 * is capped at the bill's current amount_paid (the SP also enforces this).
 */
export function RecordRefundForm({
  billId,
  amountPaid,
}: {
  billId: number;
  amountPaid: number;
}) {
  const [state, action, pending] = useActionState(recordRefundAction, initial);
  const [method, setMethod] = useState<PayMethod>('Cash');
  const [amountInput, setAmountInput] = useState(String(amountPaid));
  const showTxnRef = method !== 'Cash';

  // Sync the cap-bound amount input with the post-revalidate amountPaid prop.
  // Without this it sticks at the just-refunded value and looks like the
  // input didn't clear after pressing Refund.
  useEffect(() => {
    setAmountInput(String(amountPaid));
  }, [amountPaid]);

  // See record-payment.tsx for the full rationale. React 19's form-action
  // auto-reset visually resets the <select> without firing onChange, leaving
  // local `method` state out of sync with the DOM and keeping the txnRef
  // input rendered even though the select reads "Cash".
  const prevStateRef = useRef(state);
  useEffect(() => {
    if (state !== prevStateRef.current && state.ok) {
      setMethod('Cash');
    }
    prevStateRef.current = state;
  }, [state]);

  const amountNum = Number(amountInput);
  const isAmountValid =
    Number.isFinite(amountNum) && amountNum >= 1 && amountNum <= amountPaid;
  const exceedsCap = Number.isFinite(amountNum) && amountNum > amountPaid;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="billId" value={billId} />
      <p className="text-sm font-medium text-zinc-900">Record refund</p>
      <div className="flex items-end gap-2">
        <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
          <div className="space-y-1 min-w-0">
            <Label htmlFor="refund-method">Method</Label>
            <select
              id="refund-method"
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
            <Label htmlFor="refund-amount">Amount (₹)</Label>
            <Input
              id="refund-amount"
              name="amount"
              type="number"
              inputMode="numeric"
              min={1}
              max={amountPaid}
              value={amountInput}
              onChange={(e) => {
                // Cap refund at amountPaid; the SP also enforces this but
                // failing client-side avoids a wasted round trip.
                const raw = e.target.value;
                if (raw === '') {
                  setAmountInput('');
                  return;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                setAmountInput(n > amountPaid ? String(amountPaid) : raw);
              }}
              aria-invalid={!isAmountValid}
              className="w-full border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 focus-visible:border-primary"
            />
          </div>
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={pending || !isAmountValid}
          className="shrink-0"
        >
          {pending ? 'Recording…' : 'Refund'}
        </Button>
      </div>
      {exceedsCap && (
        <p className="text-xs text-destructive">
          ✗ Refund cannot exceed the amount already received (₹
          {amountPaid.toLocaleString('en-IN')}).
        </p>
      )}
      {showTxnRef && (
        <div className="space-y-1">
          <Label htmlFor="refund-txnRef" className="text-zinc-900">
            Transaction number{' '}
            <span className="text-xs font-normal text-zinc-500">(optional)</span>
          </Label>
          <Input
            id="refund-txnRef"
            name="txnRef"
            maxLength={100}
            placeholder={
              method === 'UPI'
                ? 'UPI refund reference / UTR'
                : method === 'Cheque'
                  ? 'Cheque number'
                  : method === 'Card'
                    ? 'Card refund reference'
                    : `${method} reference`
            }
            className="border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 focus-visible:border-primary"
          />
        </div>
      )}
      <p className="text-xs text-zinc-500">
        Maximum refundable: ₹{amountPaid.toLocaleString('en-IN')} (the amount
        already received on this bill).
      </p>
      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      {state.ok && (
        <p className="text-sm text-secondary">Refund recorded.</p>
      )}
    </form>
  );
}
