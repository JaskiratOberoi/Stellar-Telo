import { requireSession } from '@/auth/session';
import { getRecentOrders } from '@/actions/orders.actions';
import { OrdersLive } from '@/components/orders/orders-live';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  await requireSession();
  // Default to the registrations stream — that's where the LIS produces the
  // bulk of live activity (~thousands/day vs a few bills).
  const initial = await getRecentOrders('registrations', 100);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Orders</h1>
        <p className="text-xs text-muted-foreground">
          Live activity across your scope — switch between registrations,
          accessioned samples, and billed orders.
        </p>
      </div>
      <OrdersLive initial={initial} />
    </div>
  );
}
