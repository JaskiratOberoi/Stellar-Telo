'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Light/dark toggle. Shows the icon of the theme you'd switch TO (Moon while
 * in light, Sun while in dark) with a little rotate/scale flourish on change.
 * Renders a stable placeholder until mounted so server and client markup match
 * (the real theme is only known on the client, after `next-themes` reads
 * localStorage). `className` lets dark chrome (the navy sidebar) restyle it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'group flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        className,
      )}
    >
      {/* Avoid hydration mismatch: render Sun until we know the client theme. */}
      {mounted && !isDark ? (
        <Moon className="h-[18px] w-[18px] transition-transform duration-300 group-hover:-rotate-12 group-active:scale-90 motion-reduce:transition-none" />
      ) : (
        <Sun className="h-[18px] w-[18px] transition-transform duration-300 group-hover:rotate-45 group-active:scale-90 motion-reduce:transition-none" />
      )}
    </button>
  );
}
