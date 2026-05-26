'use client';

import { useActionState, useState } from 'react';
import {
  recordOfflinePayment,
  type RecordPaymentState,
} from '@/actions/payment.actions';
import { PAY_METHODS, type PayMethod } from '@/lib/payment-methods';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

  const amountNum = Number(amountInput);
  const isAmountValid =
    Number.isFinite(amountNum) && amountNum >= 1 && amountNum <= balance;
  const exceedsBalance = Number.isFinite(amountNum) && amountNum > balance;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="billId" value={billId} />
      <p className="text-sm font-medium text-zinc-900">Record offline payment</p>
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
              className="w-full border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 focus-visible:border-primary"
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
        <p className="text-xs text-destructive">
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
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      {state.ok && (
        <p className="text-sm text-secondary">Payment recorded.</p>
      )}
    </form>
  );
}
