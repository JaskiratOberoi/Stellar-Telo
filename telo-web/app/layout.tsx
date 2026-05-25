import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Telo — Billing',
  description: 'B2C billing for the Noble laboratory network',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning: some browser extensions inject attributes
          (e.g. cz-shortcut-listen) onto <body> before React hydrates. */}
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
