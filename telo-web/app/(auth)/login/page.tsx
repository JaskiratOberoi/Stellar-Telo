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
      {/* ── Full-bleed animated backdrop ──────────────────────────────────── */}
      <AmbientBackground />
      <LoginBackdrop />
      {/* Slow aurora sweep behind the brand panel */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-[20%] top-[10%] h-[70rem] w-[70rem] opacity-20 blur-3xl [animation:spin_90s_linear_infinite] motion-reduce:[animation:none] print:hidden"
        style={{
          background:
            'conic-gradient(from 90deg, transparent, hsl(var(--primary) / 0.55) 12%, transparent 32%, hsl(var(--secondary) / 0.4) 55%, transparent 75%)',
        }}
      />
      {/* Film grain */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-soft-light print:hidden"
        style={{ backgroundImage: GRAIN }}
      />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.05fr_minmax(0,1fr)]">
        {/* ── Brand showcase (desktop only) ──────────────────────────────── */}
        <section className="relative hidden flex-col justify-between p-10 lg:flex xl:p-14">
          <div className="animate-card-in motion-reduce:animate-none">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary/60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-secondary" />
              </span>
              Noble Laboratory Network
            </span>
          </div>

          <div className="max-w-md space-y-8">
            <div className="animate-card-in [animation-delay:100ms] motion-reduce:animate-none">
              <span className="animate-shimmer bg-gradient-to-r from-primary via-indigo-300 to-secondary bg-[length:200%_auto] bg-clip-text text-6xl font-bold tracking-tight text-transparent drop-shadow-[0_0_35px_hsl(var(--primary)/0.4)] motion-reduce:animate-none">
                Telo
              </span>
              <p className="mt-4 text-lg leading-relaxed text-foreground/80">
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
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-primary-foreground/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    <f.icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{f.title}</span>
                    <span className="block text-sm text-muted-foreground">
                      {f.desc}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="animate-fade-in-up text-xs text-muted-foreground/70 [animation-delay:650ms] motion-reduce:animate-none">
            Secured access · provisioned by your lab administrator
          </p>
        </section>

        {/* ── Sign-in panel ──────────────────────────────────────────────── */}
        <section className="relative flex items-center justify-center px-4 py-12 sm:px-8">
          {/* Legibility scrim — fades the wave field out under the form */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-l from-background/95 via-background/75 to-transparent lg:border-l lg:border-white/5"
          />

          <div className="relative w-full max-w-sm">
            {/* Compact brand header (mobile only) */}
            <div className="mb-10 animate-card-in text-center lg:hidden motion-reduce:animate-none">
              <span className="animate-shimmer bg-gradient-to-r from-primary via-indigo-300 to-secondary bg-[length:200%_auto] bg-clip-text text-4xl font-bold tracking-tight text-transparent drop-shadow-[0_0_25px_hsl(var(--primary)/0.45)] motion-reduce:animate-none">
                Telo
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
              <div className="mt-8 h-56 animate-pulse rounded-lg bg-white/[0.04]" />
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
                    className="h-11 rounded-lg bg-white/[0.03] px-3.5 transition-all duration-200 focus-visible:bg-white/[0.05] focus-visible:shadow-[0_0_24px_-8px_hsl(var(--primary)/0.5)]"
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
                    className="h-11 rounded-lg bg-white/[0.03] px-3.5 transition-all duration-200 focus-visible:bg-white/[0.05] focus-visible:shadow-[0_0_24px_-8px_hsl(var(--primary)/0.5)]"
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
