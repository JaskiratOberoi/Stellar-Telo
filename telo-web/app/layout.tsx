import type { Metadata } from 'next';
import { Sora, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme/theme-provider';

/* Telo 2.0 type system — self-hosted via next/font (zero layout shift, no
 * external requests at runtime):
 *  - Sora: geometric display face for headings, KPIs and the brand mark.
 *  - Inter: high-legibility UI text at dense table sizes.
 *  - JetBrains Mono: SIDs, bill numbers, client codes.
 */
const display = Sora({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700', '800'],
});
const body = Inter({
  subsets: ['latin'],
  variable: '--font-body',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Telo — Billing',
  description: 'B2C billing for the Noble laboratory network',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // suppressHydrationWarning: next-themes sets the theme class on <html> before
  // React hydrates; browser extensions also inject <body> attributes (e.g.
  // cz-shortcut-listen). The class is managed by ThemeProvider — light default.
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body
        className="min-h-screen font-sans antialiased bg-background text-foreground"
        suppressHydrationWarning
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
