import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Receipt, Wallet, History, Lock } from 'lucide-react';
import { requireSession } from '@/auth/session';
import { lisUsertypeToTeloRole } from '@/auth/rbac';
import { getMccScope, ownCentreIds } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getMccAccountSummary, listMccAccountDetail } from '@/db/read/mccLedger';
import { isCcavenueConfigured } from '@/lib/ccavenue';
import { Badge } from '@/components/ui/badge';
import { PayNowPanel } from '@/components/client-home/pay-now-panel';
import { PayStatusToast } from '@/components/client-home/pay-status-toast';
import { fmtIST, todayIST, addDaysIST } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** Time-of-day greeting in IST (server-rendered; single source of truth). */
function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }).format(new Date()),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default async function ClientHomePage({
  searchParams,
}: {
  searchParams: Promise<{ pay?: string; amt?: string; ref?: string; mcc?: string }>;
}) {
  const user = await requireSession();
  // This animated home is the B2B client landing. Staff have the full /dashboard.
  // Use the EFFECTIVE role — most clients are implicit (LIS-derived), so
  // teloRole (explicit override only) is null for them.
  {
    const role = user.teloRole ?? lisUsertypeToTeloRole(user.usertypeId);
    if (
      role !== 'client' &&
      role !== 'b2b_billing' &&
      role !== 'client_reporting'
    )
      redirect('/dashboard');
  }

  const sp = await searchParams;

  const scope = await getMccScope(user.uid);
  const units = await fetchScopedMccUnits(
    scope.slice(0, 500),
    ownCentreIds(user),
  );

  // Resolve which client/centre to show: an explicit ?mcc that's in scope, else
  // the user's own centre, else the first.
  const requested = Number(sp.mcc);
  const selected =
    (Number.isInteger(requested) && units.find((u) => u.id === requested)) ||
    (user.pccId != null && units.find((u) => u.id === user.pccId)) ||
    units[0] ||
    null;

  const configured = isCcavenueConfigured();

  return (
    <div className="space-y-5">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="animate-card-in relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-deep via-brand-deep to-primary p-6 text-primary-foreground shadow-elevation-3 sm:p-8 motion-reduce:animate-none">
        {/* Ambient glows — decorative only. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary/40 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-12 h-56 w-56 rounded-full bg-primary-foreground/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          {/* Logo + greeting: stacked on mobile, side-by-side (with a divider)
              from sm up. */}
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
            {/* Hero panel is always deep indigo, so always the on-dark (white)
                brand mark — in both themes. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/branding/noble-logo-ondark.png"
              alt="Noble Diagnostics"
              className="h-12 w-auto shrink-0"
            />
            <div className="sm:border-l sm:border-primary-foreground/20 sm:pl-5">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {greeting()}, {user.name.split(' ')[0]}
              </h1>
              <p className="mt-0.5 text-sm text-primary-foreground/75">
                {selected ? (
                  // Most clients have a distinct name + code (e.g. "DELTA
                  // PATHLAB · DL0002"); when they're identical, show it once.
                  selected.name &&
                  selected.name.toLowerCase() !== selected.code.toLowerCase() ? (
                    <>
                      {selected.name}{' '}
                      <span className="font-mono text-xs">· {selected.code}</span>
                    </>
                  ) : (
                    <span className="font-mono">{selected.code}</span>
                  )
                ) : (
                  'Welcome to your Noble account'
                )}
              </p>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1 text-xs text-primary-foreground/80 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Noble Laboratory Network
          </span>
        </div>

        {/* Multi-centre switcher (only when a client maps to more than one). */}
        {units.length > 1 && (
          <div className="relative mt-6 flex flex-wrap gap-2">
            {units.map((u) => (
              <Link
                key={u.id}
                href={`/home?mcc=${u.id}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/50 ${
                  selected?.id === u.id
                    ? 'border-primary-foreground/40 bg-primary-foreground/15 text-primary-foreground'
                    : 'border-primary-foreground/15 text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground'
                }`}
              >
                {u.name ?? u.code}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Pay status toast (post-redirect) ─────────────────────────────── */}
      {sp.pay && (
        <PayStatusToast
          status={sp.pay}
          amount={sp.amt ?? null}
          reference={sp.ref ?? null}
        />
      )}

      {selected ? (
        <ClientHomeBody
          mcc={selected.id}
          configured={configured}
        />
      ) : (
        <div className="animate-fade-in-up rounded-2xl border border-border bg-card p-8 text-center shadow-elevation-1 motion-reduce:animate-none">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Wallet aria-hidden className="h-6 w-6 text-muted-foreground" />
          </span>
          <p className="mt-3 text-sm font-medium">No client account linked</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your login isn&apos;t mapped to a collection centre yet. Please
            contact Noble support.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Balance + Pay panel + recent payments for the selected client. Split out so
 * the data fetch only runs once a centre is resolved.
 */
async function ClientHomeBody({
  mcc,
  configured,
}: {
  mcc: number;
  configured: boolean;
}) {
  const td = todayIST();
  const [summary, recent] = await Promise.all([
    getMccAccountSummary(mcc, { from: '2000-01-01', to: td }),
    listMccAccountDetail(mcc, { from: addDaysIST(td, -120), to: td }, 'payment'),
  ]);

  const balance = summary.currentBalance;
  const due = balance < 0 ? -balance : 0;
  const credit = balance > 0 ? balance : 0;

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[1.35fr_1fr]">
      {/* Balance — left column, row 1 on desktop; first on mobile. */}
      <div className="order-1 lg:col-start-1 lg:row-start-1">
        <div className="animate-fade-in-up overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elevation-2 motion-reduce:animate-none">
          <div
            className={`px-6 py-6 ${
              due > 0
                ? 'bg-gradient-to-br from-destructive/10 to-transparent'
                : 'bg-gradient-to-br from-success/10 to-transparent'
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {due > 0 ? 'Amount due to Noble' : 'Account balance'}
            </p>
            <p
              className={`mt-1 text-4xl font-bold tracking-tight tabular-nums ${
                due > 0 ? 'text-destructive' : 'text-success'
              }`}
            >
              {due > 0 ? inr(due) : credit > 0 ? inr(credit) : '₹0'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {due > 0
                ? 'Outstanding balance on your account'
                : credit > 0
                  ? 'In credit — advance balance with Noble'
                  : "You're all settled. Thank you!"}
            </p>
            {due > 0 && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <p className="text-xs leading-relaxed text-destructive">
                  Reports are on hold while a balance is outstanding. Clear your
                  dues to unlock and download your reports.
                </p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 divide-x divide-border/60 border-t border-border/60">
            <div className="px-6 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Total paid (all-time)
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">
                {inr(summary.totalDeposited)}
              </p>
            </div>
            <div className="px-6 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Total test charges
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">
                {inr(summary.totalTestCharges)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent payments — left column, row 2 on desktop; last on mobile
          (below the Pay panel). */}
      <div className="order-3 lg:col-start-1 lg:row-start-2">
        <div className="animate-fade-in-up rounded-2xl border border-border/70 bg-card shadow-elevation-1 motion-reduce:animate-none [animation-delay:80ms]">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <History aria-hidden className="h-4 w-4 text-muted-foreground" />
              Recent payments
            </h2>
            <Link
              href={`/client-accounts/${mcc}`}
              className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Full account
              <ArrowRight aria-hidden className="h-3 w-3" />
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Receipt
                  aria-hidden
                  className="h-5 w-5 text-muted-foreground/70"
                />
              </span>
              <p className="mt-2.5 text-xs text-muted-foreground">
                No payments in the last 120 days.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {recent.slice(0, 5).map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {fmtIST(r.date, 'date')}
                    </p>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5">
                      <Badge variant="muted" className="max-w-full truncate">
                        {r.mode || 'Payment'}
                        {r.chequeNo ? ` · ${r.chequeNo}` : ''}
                      </Badge>
                      {r.isOnline && <Badge variant="success">Online</Badge>}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-success">
                    {inr(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Pay Now — right column on desktop (spans both rows, sticky); second
          on mobile, directly under the balance and above recent payments. */}
      <div className="order-2 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-6 lg:self-start">
        <PayNowPanel mcc={mcc} due={due} configured={configured} />
      </div>
    </div>
  );
}
