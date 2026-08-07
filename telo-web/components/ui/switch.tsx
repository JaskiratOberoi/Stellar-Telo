'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Modern toggle switch — a real `<input type="checkbox">` (so it keeps native
 * form semantics, keyboard support and screen-reader behaviour) with the box
 * visually hidden and a pill track + sliding knob drawn around it.
 *
 * The knob lives INSIDE the track, which is the input's sibling, so it can't be
 * targeted by `peer-checked:` alone (that compiles to a general-sibling
 * selector). The track therefore carries `peer-checked:[&>span]:…`, which
 * resolves to `.peer:checked ~ .track > span` and moves the knob.
 *
 * `label` renders the text beside the switch and makes the whole row clickable;
 * omit it and pass `aria-label` when the switch stands alone.
 */
export interface SwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: React.ReactNode;
  /** 'sm' for dense permission grids; 'md' (default) elsewhere. */
  size?: 'sm' | 'md';
  /** Extra classes for the wrapping <label>. */
  className?: string;
}

const TRACK = {
  sm: 'h-4 w-7',
  md: 'h-5 w-9',
} as const;

/** Applied to the TRACK (the input's sibling) — it slides the knob via a
 *  descendant selector. Carries no sizing: the knob sizes itself below, and a
 *  stray h-/w- here would fight the track's own TRACK[size] classes. */
const KNOB_SLIDE = {
  sm: 'peer-checked:[&>span]:translate-x-3',
  md: 'peer-checked:[&>span]:translate-x-4',
} as const;

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ label, size = 'md', className, disabled, ...props }, ref) => (
    <label
      className={cn(
        'group inline-flex items-start gap-2',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        className="peer sr-only"
        disabled={disabled}
        {...props}
      />
      <span
        aria-hidden
        className={cn(
          'relative mt-px shrink-0 rounded-full border border-foreground/10 bg-foreground/15 transition-colors duration-200',
          // On: brand gradient + a soft glow so "granted" reads at a glance.
          'peer-checked:border-transparent peer-checked:bg-primary peer-checked:shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]',
          // Keyboard focus lands on the hidden input — surface it on the track.
          'peer-focus-visible:ring-2 peer-focus-visible:ring-ring/70 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-background',
          !disabled && 'group-hover:bg-foreground/25 peer-checked:group-hover:brightness-110',
          TRACK[size],
          KNOB_SLIDE[size],
        )}
      >
        {/* Centred with top-0.5 rather than a translateY: the vertical
            transform would collide with the peer-checked translate-x that
            slides the knob (both compile to `transform`). Track/knob sizes
            differ by 4px in both variants, so 2px insets centre it exactly. */}
        <span
          className={cn(
            'absolute left-0.5 top-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none',
            size === 'sm' ? 'h-3 w-3' : 'h-4 w-4',
          )}
        />
      </span>
      {label != null && <span className="min-w-0">{label}</span>}
    </label>
  ),
);
Switch.displayName = 'Switch';

export { Switch };
