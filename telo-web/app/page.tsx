import Link from 'next/link';
import { ArrowRight, FileText, Receipt, Wallet } from 'lucide-react';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { RibbonBackground } from '@/components/ui/ribbon-background';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Signed-out landing page. Mirrors the portal's visual language: ambient blob
 * background, gradient wordmark, branded CTA and a row of capability chips.
 */
const FEATURES = [
  { icon: Receipt, label: 'Billing & orders' },
  { icon: FileText, label: 'Lab reports' },
  { icon: Wallet, label: 'Accounts' },
] as const;

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      <AmbientBackground className="fixed" />
      <RibbonBackground className="fixed" />

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center gap-7">
        {/* Network badge */}
        <span className="animate-fade-in-up inline-flex items-center gap-2 rounded-full border border-white/10 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
          Noble Laboratory Network
        </span>

        {/* Wordmark + tagline */}
        <div className="animate-fade-in-up space-y-3 [animation-delay:60ms]">
          <h1 className="bg-gradient-to-br from-white to-white/60 bg-clip-text pb-1 text-6xl font-bold tracking-tight text-transparent sm:text-7xl">
            Telo
          </h1>
          <p className="text-balance text-base text-muted-foreground sm:text-lg">
            B2C billing for the Noble laboratory network — orders, reports and
            accounts in one place.
          </p>
        </div>

        {/* CTA */}
        <Link
          href="/login"
          className={cn(
            buttonVariants({ variant: 'default', size: 'lg' }),
            'animate-fade-in-up group gap-2 px-8 [animation-delay:120ms]',
          )}
        >
          Sign in
          <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>

        {/* Capability chips */}
        <div className="animate-fade-in-up flex flex-wrap items-center justify-center gap-2 [animation-delay:180ms]">
          {FEATURES.map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/5 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground"
            >
              <Icon className="h-3.5 w-3.5 text-primary" />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Footer note */}
      <p className="animate-fade-in-up absolute bottom-6 z-10 text-xs text-muted-foreground/70 [animation-delay:240ms]">
        Sign in with your LIS credentials
      </p>
    </main>
  );
}
