import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme/theme-provider';

// Self-hosted via next/font — zero layout shift, no external requests at
// runtime. Inter for UI text, JetBrains Mono for sample IDs / codes / money
// columns that want unambiguous digits.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Telo — Billing',
  description: 'Billing & reporting for the Noble laboratory network',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Match the shell chrome (sidebar navy / page background) in the browser UI.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F8F8FD' },
    { media: '(prefers-color-scheme: dark)', color: '#0D0C17' },
  ],
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
      className={`${inter.variable} ${jetbrainsMono.variable}`}
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
