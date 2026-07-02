'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import {
  cancelTestAction,
  type BillingAdminState,
} from '@/actions/billing-admin.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initial: BillingAdminState = { ok: false, error: null };

/**
 * Super-admin-only "Cancel" control for a single test line on the order page.
 * Requires a reason, then calls cancelTestAction — the server keeps the line,
 * adds a negative "(Cancelled)" offset, removes the ordered-test row, and pulls
 * the code from a still-registered SID. The SP's block messages (accessioned /
 * master / split) surface inline. Rendered only for super admins on active
 * (positive, not-yet-cancelled) lines; the action re-checks the role.
 */
export function CancelTestButton({
  billId,
  lineId,
  testName,
  amount,
}: {
  billId: number;
  lineId: number;
  testName: string | null;
  amount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(cancelTestAction, initial);

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
        className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
        title="Cancel this test (super admin)"
      >
        Cancel
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm motion-reduce:animate-none sm:p-6"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="mt-10 w-full max-w-sm animate-scale-in rounded-xl border border-border bg-card text-foreground shadow-elevation-4 motion-reduce:animate-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/70 p-3">
              <p className="text-sm font-medium">Cancel test</p>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form action={action} className="space-y-3 p-4">
              <input type="hidden" name="billId" value={billId} />
              <input type="hidden" name="lineId" value={lineId} />

              <p className="text-sm text-muted-foreground">
                Cancel{' '}
                <span className="font-medium text-foreground">
                  {testName ?? 'this test'}
                </span>{' '}
                (<span className="font-semibold text-foreground">
                  ₹{amount.toLocaleString('en-IN')}
                </span>
                )? A matching <span className="font-medium">−₹{amount.toLocaleString('en-IN')}</span>{' '}
                line is added to the bill and the test is pulled from its sample
                if it hasn&apos;t been accessioned yet.
              </p>

              <div className="space-y-0.5">
                <Label htmlFor="cancel-reason">
                  Reason <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cancel-reason"
                  name="reason"
                  required
                  maxLength={200}
                  placeholder="e.g. added by mistake / patient declined"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button type="submit" size="sm" variant="destructive" disabled={pending}>
                  {pending ? 'Cancelling…' : 'Cancel test'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  Keep test
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
