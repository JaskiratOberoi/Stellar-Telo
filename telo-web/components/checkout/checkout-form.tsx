'use client';

import { useActionState, useEffect, useState } from 'react';
import { placeOrder, type PlaceOrderState } from '@/actions/order.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initial: PlaceOrderState = { error: null };

export function CheckoutForm({ total }: { total: number }) {
  const [state, action, pending] = useActionState(placeOrder, initial);

  // Skip SSR so browser extensions can't mutate inputs before hydration
  // (see comment in register-form.tsx — same root cause).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div className="h-72 animate-pulse rounded-md border bg-muted/40" />
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="vailid">Sample ID / SID *</Label>
          <Input
            id="vailid"
            name="vailid"
            required
            maxLength={50}
            placeholder="Scan or enter the sample's barcode/SID"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            The physical sample&apos;s own ID. Must be unique — duplicates are
            rejected.
          </p>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="name">Patient name *</Label>
          <Input id="name" name="name" required maxLength={200} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="age">Age</Label>
          <Input id="age" name="age" type="number" min={0} max={150} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gender">Gender (1 = M, 2 = F)</Label>
          <Input id="gender" name="gender" type="number" min={0} max={3} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mobile">Mobile</Label>
          <Input id="mobile" name="mobile" maxLength={20} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" maxLength={100} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="clinicalHistory">Clinical history</Label>
          <Input
            id="clinicalHistory"
            name="clinicalHistory"
            maxLength={500}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="discountAmount">Discount (₹)</Label>
          <Input
            id="discountAmount"
            name="discountAmount"
            type="number"
            min={0}
            defaultValue={0}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="receiptAmount">Amount paid now (₹)</Label>
          <Input
            id="receiptAmount"
            name="receiptAmount"
            type="number"
            min={0}
            defaultValue={0}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="paymentType">Payment type</Label>
          <Input
            id="paymentType"
            name="paymentType"
            placeholder="Cash / Card / Online"
            maxLength={50}
          />
        </div>
      </div>

      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Placing order…' : `Place order · ₹${total}`}
      </Button>
    </form>
  );
}
