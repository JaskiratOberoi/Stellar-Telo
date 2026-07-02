import { redirect } from 'next/navigation';
import { ReceiptText } from 'lucide-react';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getPricedCart } from '@/actions/cart.actions';
import { CheckoutForm } from '@/components/checkout/checkout-form';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'order:create')) redirect('/dashboard');

  const cart = await getPricedCart();
  if (cart.mccCode == null || cart.lines.length === 0 || cart.hasUnresolved) {
    redirect('/cart');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Checkout"
        description="Patient details for this order. Prices are final, re-resolved server-side at submit."
        backHref="/cart"
        backLabel="Back to cart"
        className="mb-0"
      />

      {/* Summary first in the DOM so phones read order → details; on desktop
          the form leads and the summary rides sticky alongside it. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <Card className="order-2 animate-fade-in-up motion-reduce:animate-none lg:order-1">
          <CardHeader>
            <CardTitle className="text-base">Patient &amp; payment</CardTitle>
          </CardHeader>
          <CardContent>
            <CheckoutForm total={cart.total} />
          </CardContent>
        </Card>

        <Card className="order-1 shadow-elevation-3 animate-fade-in-up motion-reduce:animate-none lg:order-2 lg:sticky lg:top-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ReceiptText className="h-4 w-4 text-primary" aria-hidden />
              Order summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/60 text-sm">
              {cart.lines.map((l) => (
                <li
                  key={`${l.kind}-${l.id}`}
                  className="flex items-start justify-between gap-3 py-2.5 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {l.code}
                    </p>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">
                    ₹{l.rate}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-3 text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">₹{cart.total}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
