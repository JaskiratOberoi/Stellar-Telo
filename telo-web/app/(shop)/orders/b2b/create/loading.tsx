import { Skeleton } from '@/components/ui/skeleton';

export default function B2bOrderCreateLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-48" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[520px] rounded-xl" />
        <Skeleton className="h-[520px] rounded-xl" />
      </div>
    </div>
  );
}
