// Focused billing mode — Orders tab is hidden for now. The receipt at
// /orders/[id] and the worklist at /orders/new/* remain accessible.
// Re-enable by deleting this redirect and restoring the original page.
import { redirect } from 'next/navigation';

export default function OrdersPage() {
  redirect('/dashboard');
}
