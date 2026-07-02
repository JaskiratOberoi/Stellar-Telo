'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react';

type Tone = 'success' | 'error' | 'warning';

const MESSAGES: Record<string, { tone: Tone; title: string; body?: string }> = {
  success: { tone: 'success', title: 'Payment successful' },
  failed: {
    tone: 'error',
    title: 'Payment failed',
    body: 'No amount was charged. You can try again.',
  },
  cancelled: {
    tone: 'warning',
    title: 'Payment cancelled',
    body: 'You exited before completing the payment. Nothing was charged.',
  },
  badamount: {
    tone: 'error',
    title: 'Invalid amount',
    body: 'Please enter a valid amount and try again.',
  },
  forbidden: {
    tone: 'error',
    title: 'Not permitted',
    body: 'This account is outside your access.',
  },
  unconfigured: {
    tone: 'warning',
    title: 'Online payments not enabled yet',
    body: 'Please check back shortly.',
  },
  error: {
    tone: 'error',
    title: 'Something went wrong',
    body: 'Your payment could not be processed. If money was debited it will be auto-refunded.',
  },
};

const TONE_STYLES: Record<Tone, string> = {
  success: 'border-success/40 bg-success/10 text-success',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  warning: 'border-warning/40 bg-warning/10 text-warning',
};

/**
 * Renders an animated banner from the `?pay=…` status set by the CCAvenue
 * callback redirect, then strips the query params so a refresh doesn't re-show
 * it. Success carries the amount + reference for confirmation.
 */
export function PayStatusToast({
  status,
  amount,
  reference,
}: {
  status: string;
  amount: string | null;
  reference: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  // Clear the query string so the toast is one-shot (refresh-safe).
  useEffect(() => {
    const t = setTimeout(() => router.replace(pathname), 6000);
    return () => clearTimeout(t);
  }, [router, pathname]);

  const cfg = MESSAGES[status] ?? MESSAGES.error;
  if (!open) return null;

  const Icon =
    cfg.tone === 'success'
      ? CheckCircle2
      : cfg.tone === 'warning'
        ? AlertTriangle
        : XCircle;

  const amt =
    amount && Number.isFinite(Number(amount))
      ? `₹${Number(amount).toLocaleString('en-IN')}`
      : null;

  return (
    <div
      role="status"
      className={`animate-pop flex items-start gap-3 rounded-xl border px-4 py-3 shadow-elevation-2 motion-reduce:animate-none ${TONE_STYLES[cfg.tone]}`}
    >
      <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {cfg.title}
          {cfg.tone === 'success' && amt ? ` — ${amt} credited` : ''}
        </p>
        <p className="text-xs opacity-90">
          {cfg.tone === 'success'
            ? `Your account has been updated.${reference ? ` Ref: ${reference}` : ''}`
            : cfg.body}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
