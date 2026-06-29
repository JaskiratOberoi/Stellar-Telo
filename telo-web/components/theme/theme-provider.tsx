'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * App-wide theme provider. Light is the default; users flip to dark via the
 * top-right toggle (see `ThemeToggle`). `next-themes` persists the choice to
 * `localStorage` under `telo-theme` and injects a pre-paint script so the
 * stored theme applies with no flash on the next visit.
 *
 * - attribute="class"     → toggles `.dark` on <html> (matches Tailwind's
 *                           darkMode: ['class'] and globals.css).
 * - enableSystem={false}  → a deliberate light default + manual toggle, rather
 *                           than following the OS preference.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="telo-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
