'use client';

import * as React from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Render the dash (mixed) state — e.g. a "select all" with a partial set. */
  indeterminate?: boolean;
}

/**
 * Theme-matched checkbox: a native <input> with `appearance-none` styled as a
 * rounded box (subtle border when empty, solid primary + check/dash icon when
 * active). Keeps native semantics/keyboard/focus, no Radix dependency. The
 * wrapper sizing class can be overridden via `className` (e.g. margins for
 * top-aligned table rows).
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    { className, indeterminate = false, checked, disabled, ...props },
    ref,
  ) {
    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);
    React.useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    const showCheck = !!checked && !indeterminate;

    return (
      <span
        className={cn(
          'relative inline-flex h-[18px] w-[18px] shrink-0 align-middle',
          disabled && 'opacity-40',
          className,
        )}
      >
        <input
          ref={innerRef}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          className={cn(
            'peer h-full w-full cursor-pointer appearance-none rounded-[5px]',
            'border border-white/20 bg-white/[0.04] shadow-sm outline-none transition-colors',
            'hover:border-white/40',
            'checked:border-primary checked:bg-primary',
            'indeterminate:border-primary indeterminate:bg-primary',
            'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0',
            'disabled:cursor-not-allowed',
          )}
          {...props}
        />
        {/* Active glyph — sits on top of the filled box. */}
        {showCheck && (
          <Check
            className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-primary-foreground"
            strokeWidth={3.5}
          />
        )}
        {indeterminate && (
          <Minus
            className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-primary-foreground"
            strokeWidth={3.5}
          />
        )}
      </span>
    );
  },
);
