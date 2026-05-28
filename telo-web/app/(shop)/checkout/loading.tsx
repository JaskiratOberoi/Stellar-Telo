import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function CheckoutLoading() {
  return <PageSkeleton cards={3} cardHeight="h-48" />;
}
