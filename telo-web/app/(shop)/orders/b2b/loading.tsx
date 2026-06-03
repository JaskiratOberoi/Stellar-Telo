import { Skeleton } from '@/components/ui/skeleton';

export default function B2bOrderWorklistLoading() {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-8 w-24" />
      </div>
      {/* Table rows */}
      <Skeleton className="h-10 rounded-t-lg" />
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}
