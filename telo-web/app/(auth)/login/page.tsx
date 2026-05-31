'use client';

import { useActionState, useEffect, useState } from 'react';
import { loginAction, type LoginState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { AmbientBackground } from '@/components/ui/ambient-background';

const initial: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initial);
  // Render client-only so browser extensions cannot mutate input fields
  // before React hydrates (the cause of recurring shark-* hydration errors).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <AmbientBackground />

      <div className="relative z-10 w-full max-w-sm animate-pop">
        {/* Brand mark */}
        <div className="mb-8 text-center">
          <span className="bg-gradient-to-br from-primary via-indigo-400 to-secondary bg-clip-text text-4xl font-bold tracking-tight text-transparent drop-shadow-[0_0_25px_hsl(var(--primary)/0.45)]">
            Telo
          </span>
          <p className="mt-1 text-sm text-muted-foreground">
            Noble laboratory billing
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-card/70 p-8 shadow-2xl ring-1 ring-white/5 backdrop-blur-xl">
          <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Use your existing LIS credentials
          </p>

          {!mounted ? (
            <div className="h-48 animate-pulse rounded-md bg-white/[0.04]" />
          ) : (
            <form action={formAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              {state.error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {state.error}
                </p>
              )}
              <Button
                type="submit"
                className="mt-2 w-full shadow-lg shadow-primary/20"
                disabled={pending}
              >
                {pending ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
