import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, MapPin, ShoppingCart } from 'lucide-react';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getMccScope, ownCentreIds } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getPricedCart } from '@/actions/cart.actions';
import { MccSelector } from '@/components/cart/mcc-selector';
import {
  RemoveLineButton,
  ClearCartButton,
} from '@/components/cart/line-actions';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

/** Rate-resolution provenance → badge tone. */
const sourceVariant: Record<string, NonNullable<BadgeProps['variant']>> = {
  mrp: 'muted',
  special: 'success',
  ratelist: 'info',
  fallback: 'warning',
  none: 'destructive',
};

const kindVariant: Record<string, NonNullable<BadgeProps['variant']>> = {
  master: 'default',
  profile: 'info',
  test: 'outline',
};

export default async function CartPage() {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'order:create')) redirect('/dashboard');

  const scope = await getMccScope(user.uid);
  const units = await fetchScopedMccUnits(scope, ownCentreIds(user));
  const cart = await getPricedCart();

  const checkoutReady =
    cart.mccCode != null && cart.lines.length > 0 && !cart.hasUnresolved;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cart"
        description="Prices are resolved live for the selected centre (special → rate-list → fallback)"
        backHref="/catalog"
        backLabel="Continue browsing"
        actions={cart.lines.length > 0 ? <ClearCartButton /> : undefined}
        className="mb-0"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="space-y-4">
          <Card className="animate-fade-in-up motion-reduce:animate-none">
            <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
              <span className="inline-flex items-center gap-2 text-sm font-medium">
                <MapPin className="h-4 w-4 text-primary" aria-hidden />
                Collection centre
              </span>
              <MccSelector units={units} selected={cart.mccCode} />
              {cart.mccCode == null && (
                <span className="text-sm font-medium text-destructive">
                  Select a centre to price the cart
                </span>
              )}
            </CardContent>
          </Card>

          {cart.lines.length === 0 ? (
            <Card className="animate-fade-in motion-reduce:animate-none">
              <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <ShoppingCart className="h-6 w-6 text-primary" aria-hidden />
                </div>
                <div>
                  <p className="font-semibold">Your cart is empty</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Add tests, profiles or packages from the catalog to start
                    an order.
                  </p>
                </div>
                <Button asChild className="mt-1">
                  <Link href="/catalog">
                    Browse the catalog
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-24">Type</TableHead>
                  <TableHead className="w-28">Rate source</TableHead>
                  <TableHead className="w-24 text-right">Price</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {cart.lines.map((l) => (
                  <TableRow key={`${l.kind}-${l.id}`}>
                    <TableCell className="font-mono text-xs">
                      {l.code}
                    </TableCell>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell>
                      <Badge variant={kindVariant[l.kind] ?? 'outline'}>
                        {l.kind === 'master' ? 'package' : l.kind}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={sourceVariant[l.source] ?? 'muted'}>
                        {l.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {l.rate != null ? `₹${l.rate}` : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <RemoveLineButton id={l.id} kind={l.kind} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {cart.lines.length > 0 && (
          <Card className="shadow-elevation-3 animate-fade-in-up motion-reduce:animate-none lg:sticky lg:top-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Order summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Items</dt>
                  <dd className="tabular-nums">{cart.lines.length}</dd>
                </div>
                <div className="flex items-center justify-between border-t border-border/70 pt-3 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">₹{cart.total}</dd>
                </div>
              </dl>
              {cart.hasUnresolved && (
                <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                  Some items have no resolvable rate for this centre — remove
                  them or pick another centre.
                </p>
              )}
              <Button
                asChild
                size="lg"
                disabled={!checkoutReady}
                className="w-full"
              >
                <Link
                  href={checkoutReady ? '/checkout' : '#'}
                  aria-disabled={!checkoutReady}
                  className={
                    !checkoutReady ? 'pointer-events-none opacity-50' : undefined
                  }
                >
                  Proceed to checkout
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
