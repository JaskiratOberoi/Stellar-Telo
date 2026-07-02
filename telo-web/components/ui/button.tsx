import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Press-in micro-interaction (scale 0.98 active) + a 4px soft focus halo —
  // visible on every surface without a ring-offset seam on colored cards.
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25 focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-elevation-2 hover:bg-primary/90 hover:shadow-elevation-3',
        destructive:
          'bg-destructive text-destructive-foreground shadow-elevation-1 hover:bg-destructive/90',
        outline:
          'border border-border bg-card/60 shadow-elevation-1 hover:bg-muted hover:text-foreground',
        secondary:
          'bg-secondary text-secondary-foreground shadow-elevation-1 hover:bg-secondary/85',
        ghost: 'hover:bg-foreground/[0.06] hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-8 text-[15px]',
        icon: 'h-9 w-9',
        fab: 'h-12 w-12 rounded-full shadow-elevation-4 hover:scale-105 active:scale-95',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
