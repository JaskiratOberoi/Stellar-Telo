'use client';

import { useActionState } from 'react';
import {
  recordOfflinePayment,
  type RecordPaymentState,
} from '@/actions/payment.actions';
import { PAY_METHODS } from '@/lib/payment-methods';
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

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="billId" value={billId} />
      <p className="text-sm font-medium">Record offline payment</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="method">Method</Label>
          <select
            id="method"
            name="method"
            suppressHydrationWarning
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            defaultValue="Cash"
          >
            {PAY_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="amount">Amount (₹)</Label>
          <Input
            id="amount"
            name="amount"
            type="number"
            min={1}
            max={balance}
            defaultValue={balance}
            className="w-32"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Recording…' : 'Record payment'}
        </Button>
      </div>
      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      {state.ok && (
        <p className="text-sm text-green-600">Payment recorded.</p>
      )}
    </form>
  );
}
