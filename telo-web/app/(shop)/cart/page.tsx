import Link from 'next/link';
import { redirect } from 'next/navigation';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

const sourceVariant = {
  mrp: 'default',
  special: 'default',
  ratelist: 'secondary',
  fallback: 'outline',
  none: 'destructive',
} as const;

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
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cart</h1>
          <p className="text-muted-foreground">
            Prices are resolved live for the selected centre (special →
            rate-list → fallback)
          </p>
        </div>
        {cart.lines.length > 0 && <ClearCartButton />}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Collection centre:</span>
        <MccSelector units={units} selected={cart.mccCode} />
        {cart.mccCode == null && (
          <span className="text-sm text-destructive">
            Select a centre to price the cart
          </span>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-24">Type</TableHead>
            <TableHead className="w-28">Rate source</TableHead>
            <TableHead className="w-24 text-right">Price</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {cart.lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                Cart is empty.{' '}
                <Link href="/catalog" className="underline">
                  Browse the catalog
                </Link>
                .
              </TableCell>
            </TableRow>
          ) : (
            cart.lines.map((l) => (
              <TableRow key={`${l.kind}-${l.id}`}>
                <TableCell className="font-mono text-xs">{l.code}</TableCell>
                <TableCell>{l.name}</TableCell>
                <TableCell>
                  <Badge
                    variant={l.kind === 'profile' ? 'secondary' : 'outline'}
                  >
                    {l.kind}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={sourceVariant[l.source]}>{l.source}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {l.rate != null ? `₹${l.rate}` : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <RemoveLineButton id={l.id} kind={l.kind} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {cart.lines.length > 0 && (
        <div className="flex items-center justify-between border-t pt-4">
          <div className="text-sm text-muted-foreground">
            {cart.hasUnresolved &&
              'Some items have no resolvable rate for this centre — remove them or pick another centre.'}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-lg font-semibold">
              Total: ₹{cart.total}
            </span>
            <Button asChild disabled={!checkoutReady}>
              <Link
                href={checkoutReady ? '/checkout' : '#'}
                aria-disabled={!checkoutReady}
              >
                Proceed to checkout
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
