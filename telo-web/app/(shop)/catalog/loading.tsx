import { Skeleton } from '@/components/ui/skeleton';

export default function CatalogLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-5 w-80" />
      </div>
      <Skeleton className="h-9 max-w-md" />
      <Skeleton className="h-10 rounded-t-lg" />
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton key={i} className="h-11" />
      ))}
    </div>
  );
}
