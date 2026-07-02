'use client';

import { useActionState, useEffect, useState } from 'react';
import { ArrowRight, FileText, Loader2, Receipt, Wallet } from 'lucide-react';
import { loginAction, type LoginState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { LoginBackdrop } from '@/components/ui/login-backdrop';
import { VersionBadge } from '@/components/ui/version-badge';

const initial: LoginState = { error: null };

/** What signing in unlocks — mirrors the landing page's three pillars. */
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

/** Tiny tileable fractal-noise SVG — overlaid at ~3% for a film-grain finish. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initial);
  // Render client-only so browser extensions cannot mutate input fields
  // before React hydrates (the cause of recurring shark-* hydration errors).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {/* ── Ambient blobs behind the form panel ───────────────────────────── */}
      <AmbientBackground />
      {/* Film grain */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20 opacity-[0.035] mix-blend-soft-light print:hidden"
        style={{ backgroundImage: GRAIN }}
      />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.05fr_minmax(0,1fr)]">
        {/* ── Brand showcase (desktop only) — deep-navy indigo identity ──── */}
        <section className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-sidebar via-sidebar to-sidebar-deep p-10 lg:flex xl:p-14">
          {/* Flowing ribbon canvas, retinted to the indigo→violet family */}
          <LoginBackdrop />
          {/* Slow aurora sweep */}
          <div
            aria-hidden
            className="pointer-events-none absolute -left-1/4 -top-1/4 h-[60rem] w-[60rem] opacity-25 blur-3xl [animation:spin_90s_linear_infinite] motion-reduce:[animation:none] print:hidden"
            style={{
              background:
                'conic-gradient(from 90deg, transparent, hsl(var(--primary) / 0.5) 12%, transparent 32%, hsl(var(--chart-5) / 0.35) 55%, transparent 75%)',
            }}
          />
          {/* Fine dotted grid, faded toward the edges */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_center,hsl(var(--sidebar-foreground)/0.06)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)] print:hidden"
          />

          <div className="relative animate-card-in motion-reduce:animate-none">
            <span className="inline-flex items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-foreground/[0.05] px-3 py-1 text-xs text-sidebar-muted backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary/60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-secondary" />
              </span>
              Noble Laboratory Network
            </span>
          </div>

          <div className="relative max-w-md space-y-8">
            <div className="animate-card-in [animation-delay:100ms] motion-reduce:animate-none">
              {/* Noble brand lockup — white variant on the navy panel */}
              <img
                src="/branding/noble-logo-ondark.png"
                alt="Noble Diagnostics"
                className="mb-5 h-16 w-auto"
              />
              <span className="inline-flex items-start gap-2">
                <span className="animate-shimmer bg-gradient-to-r from-sidebar-active via-chart-5 to-sidebar-active bg-[length:200%_auto] bg-clip-text text-6xl font-bold tracking-tight text-transparent drop-shadow-[0_0_35px_hsl(var(--primary)/0.45)] motion-reduce:animate-none">
                  Telo
                </span>
                <VersionBadge className="mt-1.5 border-sidebar-border bg-sidebar-foreground/10 text-sidebar-muted" />
              </span>
              <p className="mt-4 text-lg leading-relaxed text-sidebar-foreground/85">
                Billing for the Noble laboratory network — orders, reports and
                accounts in one place.
              </p>
            </div>

            <ul className="space-y-4">
              {FEATURES.map((f, i) => (
                <li
                  key={f.title}
                  className="flex animate-fade-in-up items-start gap-3.5 motion-reduce:animate-none"
                  style={{ animationDelay: `${250 + i * 120}ms` }}
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-foreground/[0.06] text-sidebar-active shadow-[inset_0_1px_0_hsl(var(--sidebar-foreground)/0.06)]">
                    <f.icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-sidebar-foreground">
                      {f.title}
                    </span>
                    <span className="block text-sm text-sidebar-muted">
                      {f.desc}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative animate-fade-in-up text-xs text-sidebar-muted/80 [animation-delay:650ms] motion-reduce:animate-none">
            Secured access · provisioned by your lab administrator
          </p>
        </section>

        {/* ── Sign-in panel ──────────────────────────────────────────────── */}
        <section className="relative flex items-center justify-center px-4 py-12 sm:px-8">
          {/* Legibility scrim — settles the ambient blobs under the form */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-l from-background/90 via-background/60 to-transparent"
          />

          <div className="relative w-full max-w-sm">
            {/* Compact brand header (mobile only) */}
            <div className="mb-10 animate-card-in text-center lg:hidden motion-reduce:animate-none">
              <img
                src="/branding/noble-logo-onlight.png"
                alt="Noble Diagnostics"
                className="mx-auto mb-4 h-14 w-auto dark:hidden"
              />
              <img
                src="/branding/noble-logo-ondark.png"
                alt="Noble Diagnostics"
                className="mx-auto mb-4 hidden h-14 w-auto dark:block"
              />
              <span className="inline-flex items-start justify-center gap-1.5">
                <span className="text-brand-gradient animate-shimmer text-4xl font-bold tracking-tight drop-shadow-[0_0_25px_hsl(var(--primary)/0.45)] motion-reduce:animate-none">
                  Telo
                </span>
                <VersionBadge className="mt-1" />
              </span>
              <p className="mt-1 text-sm text-muted-foreground">
                Noble laboratory billing
              </p>
            </div>

            <div className="animate-card-in [animation-delay:120ms] motion-reduce:animate-none">
              <h1 className="text-2xl font-semibold tracking-tight">
                Welcome back
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Sign in with your existing LIS credentials.
              </p>
            </div>

            {!mounted ? (
              <div className="mt-8 h-56 animate-pulse rounded-lg bg-foreground/[0.04]" />
            ) : (
              <form action={formAction} className="mt-8 space-y-5">
                <div className="group animate-fade-in-up space-y-2 [animation-delay:200ms] motion-reduce:animate-none">
                  <Label
                    htmlFor="username"
                    className="text-muted-foreground transition-colors group-focus-within:text-foreground"
                  >
                    Username
                  </Label>
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    required
                    autoFocus
                    className="h-11 rounded-lg bg-foreground/[0.03] px-3.5 transition-all duration-200 focus-visible:bg-foreground/[0.05] focus-visible:shadow-[0_0_24px_-8px_hsl(var(--primary)/0.5)]"
                  />
                </div>
                <div className="group animate-fade-in-up space-y-2 [animation-delay:280ms] motion-reduce:animate-none">
                  <Label
                    htmlFor="password"
                    className="text-muted-foreground transition-colors group-focus-within:text-foreground"
                  >
                    Password
                  </Label>
                  <PasswordInput
                    id="password"
                    name="password"
                    autoComplete="current-password"
                    required
                    className="h-11 rounded-lg bg-foreground/[0.03] px-3.5 transition-all duration-200 focus-visible:bg-foreground/[0.05] focus-visible:shadow-[0_0_24px_-8px_hsl(var(--primary)/0.5)]"
                  />
                </div>
                {state.error && (
                  <p
                    // Keyed by message so a repeated failure re-triggers the shake.
                    key={state.error}
                    className="animate-shake rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive motion-reduce:animate-none"
                  >
                    {state.error}
                  </p>
                )}
                <Button
                  type="submit"
                  className="group/btn relative h-11 w-full overflow-hidden rounded-lg text-[15px] shadow-lg shadow-primary/25 transition-shadow duration-300 [animation-delay:360ms] hover:shadow-primary/40 motion-safe:animate-fade-in-up"
                  disabled={pending}
                >
                  {/* Sheen sweep on hover */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-0 w-1/2 -translate-x-[150%] skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover/btn:translate-x-[300%] motion-reduce:hidden"
                  />
                  {pending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-0.5" />
                    </>
                  )}
                </Button>
              </form>
            )}

            <p className="mt-10 animate-fade-in-up text-center text-xs text-muted-foreground/70 [animation-delay:450ms] lg:hidden motion-reduce:animate-none">
              Secured access · provisioned by your lab administrator
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
