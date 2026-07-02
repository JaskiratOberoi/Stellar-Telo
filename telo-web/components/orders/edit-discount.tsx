'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, X } from 'lucide-react';
import {
  setBillDiscountAction,
  type BillingAdminState,
} from '@/actions/billing-admin.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initial: BillingAdminState = { ok: false, error: null };

/**
 * Super-admin-only discount editor for an existing bill. Renders the Summary's
 * "Discount" row with an inline edit pencil; the modal sets the absolute
 * discount via setBillDiscountAction and the server recomputes Balance
 * (= amount − discount − amount_paid). Over-discount is allowed and previewed
 * as a negative balance (refund due). The button is rendered by the server page
 * only for super admins; the action re-checks the role server-side.
 */
export function EditDiscount({
  billId,
  amount,
  discount,
  amountPaid,
}: {
  billId: number;
  amount: number;
  discount: number;
  amountPaid: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setBillDiscountAction, initial);
  const [value, setValue] = useState(String(discount));

  // Close + refresh the server-rendered Summary once a save succeeds.
  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  // Reset the input to the current discount each time the modal opens.
  useEffect(() => {
    if (open) setValue(String(discount));
  }, [open, discount]);

  // Lock background scroll + close on Escape while the modal is open.
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

  const num = Number(value);
  const valid = Number.isFinite(num) && num >= 0 && num <= amount;
  const previewBalance = valid ? amount - num - amountPaid : null;

  return (
    <>
      <div className="flex items-center justify-between text-zinc-500">
        <span>Discount</span>
        <span className="flex items-center gap-1.5">
          <span className="text-zinc-900">₹{discount.toLocaleString('en-IN')}</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            title="Edit discount (super admin)"
            aria-label="Edit discount"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </span>
      </div>

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
              <p className="text-sm font-medium">Edit discount</p>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form action={action} className="space-y-3 p-4">
              <input type="hidden" name="billId" value={billId} />

              <div className="space-y-0.5">
                <Label htmlFor="disc-amount">Discount (₹)</Label>
                <Input
                  id="disc-amount"
                  name="discount"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={amount}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  aria-invalid={!valid}
                  required
                />
              </div>

              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Bill amount</span>
                <span className="text-right font-medium text-foreground">
                  ₹{amount.toLocaleString('en-IN')}
                </span>
                <span>Already paid</span>
                <span className="text-right font-medium text-foreground">
                  ₹{amountPaid.toLocaleString('en-IN')}
                </span>
                <span>New balance</span>
                <span
                  className={`text-right font-semibold ${
                    previewBalance != null && previewBalance < 0
                      ? 'text-destructive'
                      : 'text-foreground'
                  }`}
                >
                  {previewBalance == null
                    ? '—'
                    : `₹${previewBalance.toLocaleString('en-IN')}`}
                </span>
              </div>

              {valid && previewBalance != null && previewBalance < 0 && (
                <p className="text-[11px] text-warning">
                  This discount exceeds the unpaid amount — the bill will show a
                  negative balance (₹{Math.abs(previewBalance).toLocaleString('en-IN')}{' '}
                  refund due). Record the refund separately.
                </p>
              )}

              {!valid && (
                <p className="text-[11px] text-destructive">
                  Discount must be between ₹0 and the bill amount (₹
                  {amount.toLocaleString('en-IN')}).
                </p>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button type="submit" size="sm" disabled={pending || !valid}>
                  {pending ? 'Saving…' : 'Save discount'}
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
