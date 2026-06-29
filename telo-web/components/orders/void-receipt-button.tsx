'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import {
  voidReceiptAction,
  type BillingAdminState,
} from '@/actions/billing-admin.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initial: BillingAdminState = { ok: false, error: null };

/**
 * Super-admin-only "Void" control for a single payment/refund receipt on the
 * order page. Confirms, then calls voidReceiptAction — the server keeps the
 * row for the trail but reverses its effect on amount_paid / Balance. Rendered
 * only for super admins on non-voided rows; the action re-checks the role.
 */
export function VoidReceiptButton({
  billId,
  receiptId,
  kind,
  amount,
}: {
  billId: number;
  receiptId: number;
  kind: 'payment' | 'refund';
  amount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(voidReceiptAction, initial);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
        title="Void this transaction (super admin)"
      >
        Void
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-6"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="mt-10 w-full max-w-sm rounded-lg border border-foreground/10 bg-card text-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-foreground/10 p-3">
              <p className="text-sm font-medium">Void transaction</p>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form action={action} className="space-y-3 p-4">
              <input type="hidden" name="billId" value={billId} />
              <input type="hidden" name="receiptId" value={receiptId} />

              <p className="text-sm text-muted-foreground">
                Void this {kind} of{' '}
                <span className="font-semibold text-foreground">
                  ₹{amount.toLocaleString('en-IN')}
                </span>
                ? Its effect on the bill will be reversed
                {kind === 'payment'
                  ? ' (balance goes back up)'
                  : ' (balance goes back down)'}
                . The transaction stays on record, struck through.
              </p>

              <div className="space-y-0.5">
                <Label htmlFor="void-reason">
                  Reason{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="void-reason"
                  name="reason"
                  maxLength={200}
                  placeholder="e.g. recorded against the wrong bill"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button type="submit" size="sm" variant="destructive" disabled={pending}>
                  {pending ? 'Voiding…' : 'Void transaction'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                {state.error && (
                  <span className="text-xs text-destructive">{state.error}</span>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
