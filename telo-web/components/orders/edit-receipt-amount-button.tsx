'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import {
  editReceiptAmountAction,
  type BillingAdminState,
} from '@/actions/billing-admin.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initial: BillingAdminState = { ok: false, error: null };

/**
 * Super-admin-only "Edit" control for a single payment/refund receipt on the
 * order page. Opens a dialog asking for the corrected amount and a MANDATORY
 * reason, then calls editReceiptAmountAction — the txn number and date stay
 * exactly as recorded, only the amount changes, and every edit is
 * audit-trailed in telo_receipt_edit. Rendered only for super admins on
 * non-voided rows; the action re-checks the role.
 */
export function EditReceiptAmountButton({
  billId,
  receiptId,
  kind,
  amount,
  txnId,
}: {
  billId: number;
  receiptId: number;
  kind: 'payment' | 'refund';
  amount: number;
  txnId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(editReceiptAmountAction, initial);

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
        className="rounded px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 transition-colors hover:bg-amber-50 hover:text-amber-700"
        title="Edit this transaction's amount (super admin)"
      >
        Edit
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
              <p className="text-sm font-medium">Edit transaction amount</p>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form action={action} className="space-y-3 p-4">
              <input type="hidden" name="billId" value={billId} />
              <input type="hidden" name="receiptId" value={receiptId} />

              <p className="text-sm text-muted-foreground">
                Correct the amount of this {kind}
                {txnId ? (
                  <>
                    {' '}
                    (<span className="font-mono">{txnId}</span>)
                  </>
                ) : null}
                , currently{' '}
                <span className="font-semibold text-foreground">
                  ₹{amount.toLocaleString('en-IN')}
                </span>
                . The transaction number and date stay exactly as recorded; the
                bill&apos;s balance shifts by the difference. The change is
                audit-trailed and the row is tagged &ldquo;modified&rdquo; on
                screen.
              </p>

              <div className="space-y-0.5">
                <Label htmlFor="edit-txn-amount">New amount (₹)</Label>
                <Input
                  id="edit-txn-amount"
                  name="amount"
                  type="number"
                  min={1}
                  step={1}
                  required
                  defaultValue={amount}
                />
              </div>

              <div className="space-y-0.5">
                <Label htmlFor="edit-txn-reason">Reason</Label>
                <Input
                  id="edit-txn-reason"
                  name="reason"
                  maxLength={200}
                  required
                  placeholder="e.g. operator keyed the wrong amount"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? 'Saving…' : 'Save amount'}
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
