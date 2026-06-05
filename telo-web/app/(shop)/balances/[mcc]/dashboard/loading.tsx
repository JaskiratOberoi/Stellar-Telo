import { Skeleton } from '@/components/ui/skeleton';

export default function ClientDashboardLoading() {
  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div className="space-y-1">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-44 rounded-full" />
      </div>
      <Skeleton className="h-8 w-80" />
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-72 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-lg" />
    </div>
  );
}
