'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, X } from 'lucide-react';
import {
  cancelBookingAction,
  type BillingAdminState,
} from '@/actions/billing-admin.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initial: BillingAdminState = { ok: false, error: null };

/**
 * Super-admin-only "Cancel booking" control on the order page — reverses the
 * whole order in one step. Requires a reason, then calls cancelBookingAction:
 * the server cancels every remaining test, clears any discount, and refunds the
 * amount paid, leaving a zero-balance bill. Blocked tests (accessioned / master
 * / split) are reported inline and no refund is made. Rendered only for super
 * admins when the bill still has active tests; the action re-checks the role.
 */
export function CancelBookingButton({
  billId,
  activeCount,
  amountPaid,
}: {
  billId: number;
  activeCount: number;
  amountPaid: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(cancelBookingAction, initial);

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
        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-2.5 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
        title="Cancel the whole booking (super admin)"
      >
        <Ban className="h-3.5 w-3.5" />
        Cancel booking
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
              <p className="text-sm font-medium">Cancel entire booking</p>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form action={action} className="space-y-3 p-4">
              <input type="hidden" name="billId" value={billId} />

              <p className="text-sm text-muted-foreground">
                Cancel all{' '}
                <span className="font-medium text-foreground">
                  {activeCount} remaining test{activeCount === 1 ? '' : 's'}
                </span>
                , clear any discount
                {amountPaid > 0 ? (
                  <>
                    {' '}and refund{' '}
                    <span className="font-semibold text-foreground">
                      ₹{amountPaid.toLocaleString('en-IN')}
                    </span>{' '}
                    to the patient
                  </>
                ) : null}
                ? This leaves a zero-balance bill. Tests already accessioned (or
                master / split items) must be cancelled in the LIS first.
              </p>

              <div className="space-y-0.5">
                <Label htmlFor="cancel-booking-reason">
                  Reason <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cancel-booking-reason"
                  name="reason"
                  required
                  maxLength={200}
                  placeholder="e.g. booking made in error / patient cancelled"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button type="submit" size="sm" variant="destructive" disabled={pending}>
                  {pending ? 'Cancelling…' : 'Cancel booking'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  Keep booking
                </Button>
                {state.error && (
                  <span className="w-full text-xs text-destructive">{state.error}</span>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
