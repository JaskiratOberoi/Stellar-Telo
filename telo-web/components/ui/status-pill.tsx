import { cn } from '@/lib/utils';

export type OrderStatus =
  | 'pending'
  | 'in_progress'
  | 'delivered'
  | 'canceled'
  | 'done';

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  delivered: 'Delivered',
  canceled: 'Canceled',
  done: 'Done',
};

const STATUS_CLASSES: Record<OrderStatus, string> = {
  pending: 'bg-warning/15 text-warning',
  in_progress: 'bg-primary/10 text-primary',
  delivered: 'bg-success/15 text-success',
  canceled: 'bg-destructive/15 text-destructive',
  done: 'bg-muted text-muted-foreground',
};

const DOT_CLASSES: Record<OrderStatus, string> = {
  pending: 'bg-warning',
  in_progress: 'bg-primary animate-pulse motion-reduce:animate-none',
  delivered: 'bg-success',
  canceled: 'bg-destructive',
  done: 'bg-muted-foreground',
};

interface StatusPillProps {
  status: OrderStatus;
  className?: string;
}

export function StatusPill({ status, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-200',
        STATUS_CLASSES[status],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 rounded-full', DOT_CLASSES[status])}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}
