import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function AdminInvoiceLoading() {
  return <PageSkeleton cards={2} cardHeight="h-64" />;
}
