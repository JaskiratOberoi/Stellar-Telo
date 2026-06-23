'use client';

import { useState } from 'react';
import { IndianRupee, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Client-initiated online-payment panel. Posts a normal same-origin form to
 * /api/ccavenue/initiate, which records the order and returns a self-submitting
 * form that hands off to the CCAvenue gateway — so this is a full-page
 * navigation, not a fetch (the session cookie must ride along, and the gateway
 * redirect needs a top-level document). Amount is prefilled to the outstanding
 * due but freely editable, including advance (over-)payments.
 */
export function PayNowPanel({
  mcc,
  due,
  configured,
}: {
  mcc: number;
  /** Outstanding amount owed to the lab (₹, ≥0). 0 = settled / in credit. */
  due: number;
  /** Whether CCAvenue is configured server-side; disables submit when false. */
  configured: boolean;
}) {
  const [amount, setAmount] = useState<string>(due > 0 ? String(due) : '');
  const [submitting, setSubmitting] = useState(false);

  const amountNum = Math.floor(Number(amount));
  const valid = Number.isInteger(amountNum) && amountNum > 0;
  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  return (
    <div className="animate-fade-in-up overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/[0.07] to-card shadow-sm [animation-delay:120ms]">
      <div className="border-b border-primary/10 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <IndianRupee className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Pay Noble online</h2>
            <p className="text-[11px] text-muted-foreground">
              Instant, secure settlement to your account
            </p>
          </div>
        </div>
      </div>

      <form
        action="/api/ccavenue/initiate"
        method="post"
        onSubmit={() => setSubmitting(true)}
        className="space-y-4 p-5"
      >
        <input type="hidden" name="mcc" value={mcc} />

        <div className="space-y-1.5">
          <label
            htmlFor="pay-amount"
            className="text-xs font-medium text-muted-foreground"
          >
            Amount to pay
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground">
              ₹
            </span>
            <input
              id="pay-amount"
              name="amount"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={amount !== '' && !valid}
              placeholder="0"
              className="h-14 w-full rounded-xl border border-input bg-background pl-9 pr-4 text-2xl font-bold tracking-tight tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>

          {/* Quick fill — pay the full outstanding due in one tap. */}
          {due > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => setAmount(String(due))}
                className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              >
                Pay full due · {inr(due)}
              </button>
              {amount !== '' && (
                <button
                  type="button"
                  onClick={() => setAmount('')}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
                >
                  Clear
                </button>
              )}
            </div>
          )}
          {due <= 0 && (
            <p className="pt-1 text-[11px] text-muted-foreground">
              Your account is settled — any amount you pay now is held as advance
              credit.
            </p>
          )}
        </div>

        <Button
          type="submit"
          size="lg"
          disabled={!valid || submitting || !configured}
          className="group h-12 w-full gap-2 text-base"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Redirecting…
            </>
          ) : (
            <>
              <Lock className="h-4 w-4" />
              {valid ? `Pay ${inr(amountNum)} securely` : 'Pay securely'}
            </>
          )}
        </Button>

        {!configured && (
          <p className="text-center text-[11px] text-amber-500">
            Online payments are being set up — please check back shortly.
          </p>
        )}

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-secondary" />
          Secured by CCAvenue · Cards, Net Banking, UPI &amp; Wallets
        </div>
      </form>
    </div>
  );
}
