'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, X } from 'lucide-react';
import {
  updatePatientInfoAction,
  type PatientEditState,
} from '@/actions/patient.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initial: PatientEditState = { ok: false, error: null };

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-foreground/10 bg-input px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * Super-admin-only "Edit patient info" button + modal on the receipt page.
 * Corrects demographics ONLY (name/age/unit/gender/mobile/email) — never tests,
 * SIDs, or amounts. Saves via updatePatientInfoAction (which writes both the
 * bill and the patient-master row). The button is rendered by the server page
 * only for super admins; the action re-checks the role server-side.
 */
export function EditPatientInfo({
  billId,
  patientName,
  age,
  ageType,
  gender,
  mobile,
  email,
}: {
  billId: number;
  patientName: string | null;
  age: number | null;
  ageType: number | null;
  gender: number | null;
  mobile: string | null;
  email: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updatePatientInfoAction, initial);

  // Close + refresh the server-rendered card once a save succeeds.
  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-foreground/10 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        title="Correct patient details (super admin)"
      >
        <Pencil className="h-3 w-3" />
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
            className="mt-10 w-full max-w-md rounded-lg border border-foreground/10 bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-foreground/10 p-3">
              <p className="text-sm font-medium">Edit patient info</p>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form action={action} className="space-y-3 p-4">
              <input type="hidden" name="billId" value={billId} />

              <div className="space-y-0.5">
                <Label htmlFor="pi-name">Patient name *</Label>
                <Input
                  id="pi-name"
                  name="patientName"
                  defaultValue={patientName ?? ''}
                  required
                  maxLength={100}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="space-y-0.5">
                  <Label htmlFor="pi-age">Age</Label>
                  <Input
                    id="pi-age"
                    name="age"
                    type="number"
                    min={0}
                    max={200}
                    defaultValue={age ?? 0}
                    required
                  />
                </div>
                <div className="space-y-0.5">
                  <Label htmlFor="pi-ageType">Unit</Label>
                  <select
                    id="pi-ageType"
                    name="ageType"
                    defaultValue={ageType ?? 1}
                    className={SELECT_CLASS}
                  >
                    <option value={1}>Years</option>
                    <option value={2}>Months</option>
                    <option value={3}>Days</option>
                  </select>
                </div>
                <div className="space-y-0.5">
                  <Label htmlFor="pi-gender">Gender</Label>
                  <select
                    id="pi-gender"
                    name="gender"
                    defaultValue={gender === 2 ? 2 : 1}
                    className={SELECT_CLASS}
                  >
                    <option value={1}>Male</option>
                    <option value={2}>Female</option>
                  </select>
                </div>
              </div>

              <div className="space-y-0.5">
                <Label htmlFor="pi-mobile">Mobile</Label>
                <Input
                  id="pi-mobile"
                  name="mobile"
                  inputMode="numeric"
                  defaultValue={mobile ?? ''}
                  maxLength={20}
                />
              </div>

              <div className="space-y-0.5">
                <Label htmlFor="pi-email">Email</Label>
                <Input
                  id="pi-email"
                  name="email"
                  type="email"
                  defaultValue={email ?? ''}
                  maxLength={100}
                />
              </div>

              <p className="text-[11px] text-muted-foreground">
                Demographics only — tests, samples and amounts are not changed.
                Updates the bill and the patient record (lab report / SID).
              </p>

              <div className="flex items-center gap-2 pt-1">
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? 'Saving…' : 'Save changes'}
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
