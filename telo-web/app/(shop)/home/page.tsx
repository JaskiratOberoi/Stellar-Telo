import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Receipt, Wallet, History } from 'lucide-react';
import { requireSession } from '@/auth/session';
import { lisUsertypeToTeloRole } from '@/auth/rbac';
import { getMccScope, ownCentreIds } from '@/auth/scope';
import { fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getMccAccountSummary, listMccAccountDetail } from '@/db/read/mccLedger';
import { isCcavenueConfigured } from '@/lib/ccavenue';
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
  if ((user.teloRole ?? lisUsertypeToTeloRole(user.usertypeId)) !== 'client')
    redirect('/dashboard');

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
      <section className="animate-card-in relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-primary/15 via-card to-card p-6 sm:p-8 motion-reduce:animate-none">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary/20 blur-3xl"
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 sm:gap-5">
            {/* Light (transparent) recolour of the brand mark so it sits on the
                dark hero without a white box. The original stays for print/report
                headers (light backgrounds). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/branding/noble-logo-light.png"
              alt="Noble Diagnostics"
              className="h-12 w-auto shrink-0"
            />
            <div className="border-l border-white/15 pl-4 sm:pl-5">
              <h1 className="text-2xl font-bold tracking-tight">
                {greeting()}, {user.name.split(' ')[0]}
              </h1>
              <p className="text-sm text-muted-foreground">
                {selected ? (
                  <>
                    {selected.name ?? `Client ${selected.id}`}{' '}
                    <span className="font-mono text-xs">· {selected.code}</span>
                  </>
                ) : (
                  'Welcome to your Noble account'
                )}
              </p>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
            Noble Laboratory Network
          </span>
        </div>

        {/* Multi-centre switcher (only when a client maps to more than one). */}
        {units.length > 1 && (
          <div className="relative mt-5 flex flex-wrap gap-2">
            {units.map((u) => (
              <Link
                key={u.id}
                href={`/home?mcc=${u.id}`}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  selected?.id === u.id
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted'
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
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <Wallet className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No client account linked</p>
          <p className="text-xs text-muted-foreground">
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
    <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
      {/* Left — balance + recent activity */}
      <div className="space-y-5">
        <div className="animate-fade-in-up overflow-hidden rounded-2xl border border-white/10 bg-card">
          <div
            className={`px-6 py-6 ${
              due > 0
                ? 'bg-gradient-to-br from-destructive/10 to-transparent'
                : 'bg-gradient-to-br from-secondary/10 to-transparent'
            }`}
          >
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {due > 0 ? 'Amount due to Noble' : 'Account balance'}
            </p>
            <p
              className={`mt-1 text-4xl font-bold tracking-tight tabular-nums ${
                due > 0 ? 'text-destructive' : 'text-secondary'
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
          </div>
          <div className="grid grid-cols-2 divide-x divide-white/5 border-t border-white/5">
            <div className="px-6 py-4">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Total paid (all-time)
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">
                {inr(summary.totalDeposited)}
              </p>
            </div>
            <div className="px-6 py-4">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Total test charges
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">
                {inr(summary.totalTestCharges)}
              </p>
            </div>
          </div>
        </div>

        {/* Recent payments */}
        <div className="animate-fade-in-up rounded-2xl border border-white/10 bg-card [animation-delay:80ms]">
          <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4 text-muted-foreground" />
              Recent payments
            </h2>
            <Link
              href={`/client-accounts/${mcc}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Full account
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <Receipt className="mx-auto h-6 w-6 text-muted-foreground/60" />
              <p className="mt-2 text-xs text-muted-foreground">
                No payments in the last 120 days.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {recent.slice(0, 5).map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {fmtIST(r.date, 'date')}
                      {r.isOnline && (
                        <span className="ml-2 rounded-full bg-secondary/15 px-1.5 py-0.5 text-[10px] font-medium text-secondary">
                          Online
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {r.mode || 'Payment'}
                      {r.chequeNo ? ` · ${r.chequeNo}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">
                    {inr(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right — Pay Now */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <PayNowPanel mcc={mcc} due={due} configured={configured} />
      </div>
    </div>
  );
}
