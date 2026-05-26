import { Skeleton } from '@/components/ui/skeleton';

export default function ReceiptLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="h-48 rounded-xl lg:col-span-4" />
        <Skeleton className="h-48 rounded-xl lg:col-span-8" />
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="h-64 rounded-xl lg:col-span-8" />
        <Skeleton className="h-64 rounded-xl lg:col-span-4" />
      </div>
    </div>
  );
}
