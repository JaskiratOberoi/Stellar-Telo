'use client';

import { useActionState } from 'react';
import {
  recordRefundAction,
  type RecordPaymentState,
} from '@/actions/payment.actions';
import { PAY_METHODS } from '@/lib/payment-methods';
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

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="billId" value={billId} />
      <p className="text-sm font-medium">Record refund</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="refund-method">Method</Label>
          <select
            id="refund-method"
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
          <Label htmlFor="refund-amount">Amount (₹)</Label>
          <Input
            id="refund-amount"
            name="amount"
            type="number"
            min={1}
            max={amountPaid}
            defaultValue={amountPaid}
            className="w-32"
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? 'Recording…' : 'Refund'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Maximum refundable: ₹{amountPaid.toLocaleString('en-IN')} (the amount
        already received on this bill).
      </p>
      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      {state.ok && (
        <p className="text-sm text-green-600">Refund recorded.</p>
      )}
    </form>
  );
}
