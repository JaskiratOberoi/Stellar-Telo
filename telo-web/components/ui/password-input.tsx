'use client';

import * as React from 'react';
import { Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Password field with a show/hide eye toggle and a live Caps Lock warning.
 * Drop-in for `<Input type="password" />` — forwards the ref and all input
 * props, so it works with native forms and server actions unchanged.
 */
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<'input'>, 'type'>
>(({ className, onKeyUp, onKeyDown, onBlur, ...props }, ref) => {
  const [show, setShow] = React.useState(false);
  const [caps, setCaps] = React.useState(false);

  const detectCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') {
      setCaps(e.getModifierState('CapsLock'));
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Input
          ref={ref}
          type={show ? 'text' : 'password'}
          className={cn('pr-10', className)}
          onKeyUp={(e) => {
            detectCaps(e);
            onKeyUp?.(e);
          }}
          onKeyDown={(e) => {
            detectCaps(e);
            onKeyDown?.(e);
          }}
          onBlur={(e) => {
            setCaps(false);
            onBlur?.(e);
          }}
          {...props}
        />
        <button
          type="button"
          // Skip the tab order so it never sits between username/password and
          // the submit button; it's a mouse/touch affordance.
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
        >
          {show ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
      {caps && (
        <p className="flex items-center gap-1.5 text-xs text-amber-400">
          <TriangleAlert className="h-3.5 w-3.5" />
          Caps Lock is on
        </p>
      )}
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';

export { PasswordInput };
