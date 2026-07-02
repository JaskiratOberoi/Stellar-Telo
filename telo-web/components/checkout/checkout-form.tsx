'use client';

import { useActionState, useEffect, useState, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { placeOrder, type PlaceOrderState } from '@/actions/order.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initial: PlaceOrderState = { error: null };

const PAYMENT_SUGGESTIONS = ['Cash', 'Card', 'Online'];

/** Section label inside the checkout form. */
function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

export function CheckoutForm({ total }: { total: number }) {
  const [state, action, pending] = useActionState(placeOrder, initial);

  // Free-text payment type, with quick-pick pills below that just set the
  // same input's value — the submitted field is unchanged.
  const [paymentType, setPaymentType] = useState('');

  // Skip SSR so browser extensions can't mutate inputs before hydration
  // (see comment in register-form.tsx — same root cause).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div className="h-72 animate-pulse rounded-lg border border-border/70 bg-muted/40 motion-reduce:animate-none" />
    );
  }

  return (
    <form action={action} className="space-y-6">
      <div className="space-y-4">
        <SectionHeading>Sample &amp; patient</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="vailid">Sample ID / SID *</Label>
            <Input
              id="vailid"
              name="vailid"
              required
              maxLength={50}
              placeholder="Scan or enter the sample's barcode/SID"
              className="font-mono"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              The physical sample&apos;s own ID. Must be unique — duplicates
              are rejected.
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
        </div>
      </div>

      <div className="space-y-4 border-t border-border/60 pt-5">
        <SectionHeading>Contact &amp; history</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
      </div>

      <div className="space-y-4 border-t border-border/60 pt-5">
        <SectionHeading>Payment</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="discountAmount">Discount (₹)</Label>
            <Input
              id="discountAmount"
              name="discountAmount"
              type="number"
              min={0}
              defaultValue={0}
              className="tabular-nums"
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
              className="tabular-nums"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="paymentType">Payment type</Label>
            <Input
              id="paymentType"
              name="paymentType"
              placeholder="Cash / Card / Online"
              maxLength={50}
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value)}
            />
            <div
              role="group"
              aria-label="Common payment types"
              className="flex flex-wrap gap-1.5"
            >
              {PAYMENT_SUGGESTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={paymentType === p}
                  onClick={() => setPaymentType(p)}
                  className={cn(
                    'h-7 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                    paymentType === p
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {state.error && (
        <div
          key={state.error}
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive animate-shake motion-reduce:animate-none"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {state.error}
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={pending}
        className="w-full tabular-nums"
      >
        {pending ? 'Placing order…' : `Place order · ₹${total}`}
      </Button>
    </form>
  );
}
