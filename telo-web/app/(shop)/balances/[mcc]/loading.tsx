import { Skeleton } from '@/components/ui/skeleton';

export default function BalanceMccLoading() {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="space-y-1">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-5 w-36" />
      </div>
      <Skeleton className="h-10 rounded-t-lg" />
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-11" />
      ))}
    </div>
  );
}
