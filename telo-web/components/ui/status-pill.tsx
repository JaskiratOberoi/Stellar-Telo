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
  pending: 'bg-white/10 text-foreground',
  in_progress: 'bg-primary/20 text-primary',
  delivered: 'bg-secondary/20 text-secondary',
  canceled: 'bg-destructive/20 text-destructive',
  done: 'bg-white/10 text-muted-foreground',
};

interface StatusPillProps {
  status: OrderStatus;
  className?: string;
}

export function StatusPill({ status, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-200',
        STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
