import Link from 'next/link';
import { ArrowRight, FileText, Receipt, Wallet } from 'lucide-react';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { LoginBackdrop } from '@/components/ui/login-backdrop';
import { VersionBadge } from '@/components/ui/version-badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Signed-out landing page. Mirrors the portal's visual language: ambient blob
 * background, the gradient "T" logomark tile, a brand-gradient wordmark and a
 * trio of capability cards leading into the sign-in CTA.
 */
const FEATURES = [
  {
    icon: Receipt,
    title: 'Billing & orders',
    desc: 'Raise orders and settle bills against live LIS data.',
  },
  {
    icon: FileText,
    title: 'Lab reports',
    desc: 'Preview, customise and download branded PDF reports.',
  },
  {
    icon: Wallet,
    title: 'Accounts',
    desc: 'Ledgers, receipts and balances for every client.',
  },
] as const;

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      <AmbientBackground className="fixed" />
      <LoginBackdrop className="fixed" />

      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-8">
        {/* Gradient logomark — same motif as the shell's brand tile */}
        <div
          aria-hidden
          className="flex h-14 w-14 animate-pop items-center justify-center rounded-xl bg-gradient-to-br from-primary via-primary to-chart-5 text-2xl font-black text-white shadow-elevation-3 motion-reduce:animate-none"
        >
          T
        </div>

        {/* Network badge */}
        <span className="inline-flex animate-fade-in-up items-center gap-2 rounded-full border border-foreground/10 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm [animation-delay:60ms] motion-reduce:animate-none">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary/60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-secondary" />
          </span>
          Noble Laboratory Network
        </span>

        {/* Wordmark + tagline */}
        <div className="animate-fade-in-up space-y-4 [animation-delay:120ms] motion-reduce:animate-none">
          <div className="flex items-start justify-center gap-2">
            <h1 className="text-brand-gradient animate-shimmer pb-1 text-6xl font-bold tracking-tight sm:text-7xl motion-reduce:animate-none">
              Telo
            </h1>
            <VersionBadge className="mt-2 sm:mt-3" />
          </div>
          <p className="mx-auto max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
            Billing for the Noble laboratory network — orders, reports and
            accounts in one place.
          </p>
        </div>

        {/* CTA */}
        <Link
          href="/login"
          className={cn(
            buttonVariants({ variant: 'default', size: 'lg' }),
            'group animate-fade-in-up gap-2 px-8 shadow-lg shadow-primary/25 transition-shadow duration-300 [animation-delay:180ms] hover:shadow-primary/40 motion-reduce:animate-none',
          )}
        >
          Sign in
          <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>

        {/* Capability cards */}
        <div className="mt-2 grid w-full gap-3 text-left sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <div
              key={title}
              className="hover-lift animate-fade-in-up rounded-xl border border-border/60 bg-card/70 p-4 shadow-elevation-1 backdrop-blur-sm motion-reduce:animate-none"
              style={{ animationDelay: `${240 + i * 70}ms` }}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <h2 className="mt-3 text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer note */}
      <p className="absolute bottom-6 z-10 animate-fade-in-up text-xs text-muted-foreground/70 [animation-delay:480ms] motion-reduce:animate-none">
        Sign in with your LIS credentials
      </p>
    </main>
  );
}
