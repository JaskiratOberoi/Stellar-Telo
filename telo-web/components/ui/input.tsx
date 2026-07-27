import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      // Browser extensions (password managers, form fillers) inject attrs
      // like data-sharkid before hydration — benign, suppress the warning.
      suppressHydrationWarning
      className={cn(
        'flex h-9 w-full rounded-lg border border-foreground/10 bg-input px-3 py-1 text-sm text-foreground shadow-sm transition-all duration-150 placeholder:text-muted-foreground hover:border-foreground/20 focus-visible:outline-none focus-visible:border-primary focus-visible:bg-card focus-visible:ring-4 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
