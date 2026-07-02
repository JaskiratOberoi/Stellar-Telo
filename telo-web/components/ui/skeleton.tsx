import { cn } from '@/lib/utils';

/**
 * Loading placeholder with a directional shimmer sweep (reads as "loading"
 * more clearly than a plain pulse). Falls back to static under
 * prefers-reduced-motion.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-foreground/[0.05]',
        className,
      )}
      {...props}
    >
      <div className="absolute inset-0 animate-shimmer-sweep bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent motion-reduce:animate-none" />
    </div>
  );
}
