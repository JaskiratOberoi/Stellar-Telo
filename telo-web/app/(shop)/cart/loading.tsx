import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function CartLoading() {
  return <PageSkeleton cards={2} cardHeight="h-40" />;
}
