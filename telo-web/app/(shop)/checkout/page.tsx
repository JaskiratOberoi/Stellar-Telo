import Link from 'next/link';
import { redirect } from 'next/navigation';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
        <p className="text-muted-foreground">
          Patient details for this order. Prices are final, re-resolved
          server-side at submit.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Patient & payment</CardTitle>
          </CardHeader>
          <CardContent>
            <CheckoutForm total={cart.total} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Order summary</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cart.lines.map((l) => (
                  <TableRow key={`${l.kind}-${l.id}`}>
                    <TableCell>
                      <span className="font-mono text-xs">{l.code}</span>{' '}
                      {l.name}
                    </TableCell>
                    <TableCell className="text-right">₹{l.rate}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold">
                    ₹{cart.total}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="mt-4 text-sm text-muted-foreground">
              <Link href="/cart" className="underline">
                Back to cart
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
