'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  registerOrder,
  searchCatalogAction,
  previewOrder,
  previewSampleGroupsAction,
  fetchRefDataAction,
  type RegisterState,
  type PreviewResult,
  type RefDataForMcc,
} from '@/actions/register.actions';
import { removeFromCart } from '@/actions/cart.actions';
import type { SampleGroup } from '@/db/sp/previewSampleGroups';
import { PAY_METHODS } from '@/lib/payment-methods';
import {
  isValidGoldCardNumber,
  isValidGoldCardHolder,
} from '@/lib/gold-card';
import type { ScopedMcc } from '@/db/read/mccUnits';
import type { CatalogItemPublic } from '@/domain/catalog/catalog.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import {
  CreatableCombobox,
  type CreatableValue,
} from '@/components/ui/creatable-combobox';
import { SidField, type SidStatus } from '@/components/register/sid-field';
import {
  MobileField,
  type MobileStatus,
} from '@/components/register/mobile-field';
import { ChevronDown, CreditCard } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Master', 'Baby', 'Baby of', 'Dr'];
const initial: RegisterState = { error: null };
const sel =
  'h-9 w-full rounded-md border border-foreground/10 bg-input px-3 text-sm text-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50';

type Picked = { id: number; kind: 'test' | 'profile' | 'master'; code: string; name: string };

// All scalar fields kept in controlled state so a server-action error
// (React 19 resets <form action>) does NOT wipe the operator's input.
type Fields = {
  title: string;
  name: string;
  age: string;
  ageType: string;
  gender: string;
  mobile: string;
  email: string;
  clinicalHistory: string;
  discountAmount: string;
};
const DEFAULTS: Fields = {
  title: 'Mr',
  name: '',
  age: '',
  ageType: '1',
  gender: '1',
  mobile: '',
  email: '',
  clinicalHistory: '',
  discountAmount: '0',
};

// One split-payment line in the form. Amounts are kept as strings (controlled
// inputs); the hidden paymentsJson field serialises them at submit.
type PayLine = { method: string; amount: string; ref: string };
const NEW_PAY_LINE: PayLine = { method: 'Cash', amount: '0', ref: '' };

export function RegisterForm({
  units,
  initialItems = [],
  mode = 'new',
}: {
  units: ScopedMcc[];
  initialItems?: { id: number; kind: 'test' | 'profile' | 'master'; code: string; name: string }[];
  /** 'b2b' shows the Client-rate / Profit% columns and bills at MRP. */
  mode?: 'new' | 'b2b';
}) {
  const isB2b = mode === 'b2b';
  // Render the form CLIENT-ONLY: browser extensions (e.g. Shark form-filler)
  // inject custom wrappers/attrs into the SSR HTML before React hydrates,
  // producing a new tree mismatch every time we patch an old one. The actual
  // gate is at the END of the hook list (search for "pageMounted gate") so
  // we never violate Rules of Hooks by varying hook count across renders.
  const [pageMounted, setPageMounted] = useState(false);
  useEffect(() => setPageMounted(true), []);

  const router = useRouter();
  const [state, action, pending] = useActionState(registerOrder, initial);

  const [mcc, setMcc] = useState<number | ''>(
    units.length === 1 ? units[0].id : '',
  );
  const [f, setF] = useState<Fields>(DEFAULTS);
  // Split payments: one or more lines (e.g. ₹500 Cash + ₹500 UPI). Starts with
  // a single Cash line whose amount auto-pins to 50% of the total (below).
  const [payments, setPayments] = useState<PayLine[]>([{ ...NEW_PAY_LINE }]);
  // Gold Card (B2C only) — when applied the whole bill is charged at 50%.
  // Card number + holder are captured and stored at Telo table level. Mutually
  // exclusive with the manual discount.
  const [goldCard, setGoldCard] = useState(false);
  const [goldNumber, setGoldNumber] = useState('');
  const [goldHolder, setGoldHolder] = useState('');
  // Live per-number usage check (max patients per mobile) — status lifted
  // here so the submit gate below can block on it, like the SID checks.
  const [mobileStatus, setMobileStatus] = useState<MobileStatus>('idle');
  // Auto-fill the first payment line with 50% of the running total so a bill is
  // never saved with ₹0 collected by mistake. Stops mirroring once the operator
  // edits any amount / adds a line, so an explicit split is always respected.
  const [receiptTouched, setReceiptTouched] = useState(false);

  const setPay = (idx: number, key: keyof PayLine, val: string) =>
    setPayments((ps) => ps.map((p, i) => (i === idx ? { ...p, [key]: val } : p)));
  const addPay = () => {
    setReceiptTouched(true);
    setPayments((ps) => [...ps, { ...NEW_PAY_LINE }]);
  };
  const removePay = (idx: number) => {
    setReceiptTouched(true);
    setPayments((ps) => (ps.length > 1 ? ps.filter((_, i) => i !== idx) : ps));
  };

  const upd =
    (k: keyof Fields) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setF((s) => ({ ...s, [k]: e.target.value }));

  // Optional clinical-history PDF. The <input type=file> is uncontrolled;
  // we keep a ref to clear it and the chosen filename for display. The file
  // input stays mounted (Patient card) so FormData picks it up at submit.
  const fileRef = useRef<HTMLInputElement>(null);
  const [clinicalFileName, setClinicalFileName] = useState<string | null>(null);

  // Ref. doctor uses structured CreatableValue state — picked existing id or
  // fresh name. Serialized into refDoctorJson at submit.
  const [refDoctor, setRefDoctor] = useState<CreatableValue>(null);
  // MRD + (IPD/OPD/ICU) is now a plain text field — operators type the
  // patient's MRD and visit-type together (e.g. "MRD-12345 OPD"). At submit
  // the value is wrapped as { kind: 'new', name } so the existing server
  // action (which writes to tbl_billing_patient_detail.ref_customer) works
  // unchanged.
  const [refCustomerText, setRefCustomerText] = useState('');

  // Per-MCC referrer lists. Every doctor/customer in Noble is owned by exactly
  // one MCC via pcc_code → mcc_unit_master.id, so the combobox must only show
  // referrers for the currently selected Client code. Cache per-mcc fetches in
  // a ref so toggling MCCs the operator has already used is instant.
  const [refData, setRefData] = useState<RefDataForMcc | null>(null);
  const [refDataLoading, setRefDataLoading] = useState(false);
  const refCache = useRef<Map<number, RefDataForMcc>>(new Map());
  const refSeq = useRef(0);

  useEffect(() => {
    if (mcc === '') {
      setRefData(null);
      setRefDoctor(null);
      setRefCustomerText('');
      return;
    }
    // Clear any prior selection — a doctor mapped to MCC A must not silently
    // carry over to MCC B. MRD is patient-specific so we clear it too.
    setRefDoctor(null);
    setRefCustomerText('');
    const cached = refCache.current.get(Number(mcc));
    if (cached) {
      setRefData(cached);
      return;
    }
    const my = ++refSeq.current;
    setRefDataLoading(true);
    (async () => {
      try {
        const data = await fetchRefDataAction(Number(mcc));
        if (my !== refSeq.current) return;
        refCache.current.set(Number(mcc), data);
        setRefData(data);
      } finally {
        if (my === refSeq.current) setRefDataLoading(false);
      }
    })();
  }, [mcc]);

  const doctorsItems = (refData?.doctors ?? []).map((d) => ({
    id: d.id,
    code: d.code ?? '',
    name: d.name,
  }));

  const [picked, setPicked] = useState<Picked[]>(initialItems);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CatalogItemPublic[]>([]);
  const [preview, setPreview] = useState<PreviewResult>({ lines: [], total: 0 });
  const [, startSearch] = useTransition();
  const [, startPreview] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Two-step submit: clicking the primary button enters "review" mode (a
  // summary panel + Back/Confirm buttons), so the operator can verify or
  // edit before the actual server action fires. Form data is in controlled
  // state, so going Back loses nothing.
  const [reviewing, setReviewing] = useState(false);

  // Sample-type groups for this order — one SID per group is needed.
  // Server computes the required groups (mcc not actually needed for grouping;
  // grouping depends on item sample types, not the centre, but we still wait
  // for both so submit gating is coherent).
  const [groups, setGroups] = useState<SampleGroup[]>([]);
  const [groupSids, setGroupSids] = useState<Record<number, string>>({});
  const [groupStatus, setGroupStatus] = useState<Record<number, SidStatus>>({});
  // SIDs are optional at order time (the lab adds them later from the worklist),
  // so the panel stays collapsed by default and doesn't compete for attention.
  const [sidsOpen, setSidsOpen] = useState(false);
  const groupsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // If a typed SID turns out to be taken or unverifiable, reveal the panel so
  // the blocking reason is never hidden behind a collapsed dropdown.
  useEffect(() => {
    if (
      Object.values(groupStatus).some((s) => s === 'taken' || s === 'error')
    ) {
      setSidsOpen(true);
    }
  }, [groupStatus]);

  useEffect(() => {
    if (groupsTimer.current) clearTimeout(groupsTimer.current);
    if (picked.length === 0) {
      setGroups([]);
      setGroupSids({});
      setGroupStatus({});
      return;
    }
    groupsTimer.current = setTimeout(async () => {
      const g = await previewSampleGroupsAction(picked);
      setGroups(g);
      // Prune SIDs/status for sample types no longer in the order.
      const keep = new Set(g.map((x) => x.sampleTypeId));
      setGroupSids((prev) => {
        const next: Record<number, string> = {};
        for (const id of keep) if (prev[id] != null) next[id] = prev[id];
        return next;
      });
      setGroupStatus((prev) => {
        const next: Record<number, SidStatus> = {};
        for (const id of keep) if (prev[id] != null) next[id] = prev[id];
        return next;
      });
    }, 250);
    return () => {
      if (groupsTimer.current) clearTimeout(groupsTimer.current);
    };
  }, [picked]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(() => {
      startSearch(async () => setResults(await searchCatalogAction(q)));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  // Debounced pricing preview. Bulk-adds from the catalog (cart hydration,
  // a profile that expands into many tests) used to fire one previewOrder
  // server action per intermediate state. With a 200 ms trailing debounce +
  // stale-sequence guard, repeated cart edits collapse into a single call.
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewSeq = useRef(0);
  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (picked.length === 0) {
      setPreview({ lines: [], total: 0 });
      return;
    }
    // Rates are resolved against the selected Client's rate list, so the
    // preview re-runs whenever the picked items OR the Client code changes.
    previewTimer.current = setTimeout(() => {
      const seq = ++previewSeq.current;
      const mccArg = mcc === '' ? null : Number(mcc);
      startPreview(async () => {
        const r = await previewOrder(mccArg, picked, isB2b);
        if (seq === previewSeq.current) setPreview(r);
      });
    }, 200);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [picked, mcc, isB2b]);

  // A Gold Card (B2C only) halves every line — the bill the patient pays. The
  // SP applies the same per-line round-half-up, so the figures match exactly.
  const goldTotal = preview.lines.reduce(
    (s, l) => s + Math.round((l.rate ?? 0) / 2),
    0,
  );
  const goldApplied = !isB2b && goldCard;
  // The billed total everything keys off: halved when a Gold Card is applied.
  const effectiveTotal = goldApplied ? goldTotal : preview.total;

  // Keep the FIRST payment line pinned to half the current total while the
  // operator hasn't overridden it. Re-runs whenever the priced total changes
  // (tests added/removed, rate list switched, Gold Card toggled).
  useEffect(() => {
    if (receiptTouched) return;
    const half =
      effectiveTotal > 0 ? String(Math.round(effectiveTotal / 2)) : '0';
    setPayments((ps) => {
      if (ps.length === 0 || ps[0].amount === half) return ps;
      const next = [...ps];
      next[0] = { ...next[0], amount: half };
      return next;
    });
  }, [effectiveTotal, receiptTouched]);

  // Sum of all payment lines = total collected now.
  const paidSum = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  // Hard floor: operators may raise the amount but can never collect below 50%
  // of the (effective) total — same figure the effect above prefills.
  const minPaid = effectiveTotal > 0 ? Math.round(effectiveTotal / 2) : 0;
  const belowMinPaid = effectiveTotal > 0 && paidSum < minPaid;

  // Hard cap for "Discount": never more than 20% of the total bill. (Disabled
  // entirely when a Gold Card is applied — the card IS the discount.)
  const maxDiscount = effectiveTotal > 0 ? Math.round(effectiveTotal * 0.2) : 0;
  const aboveMaxDiscount =
    !goldApplied &&
    effectiveTotal > 0 &&
    Number(f.discountAmount || 0) > maxDiscount;

  // Gold Card requires REAL-looking card details (not just non-empty) — a
  // plausible card number and a name — before it can be submitted.
  const goldNumberOk = isValidGoldCardNumber(goldNumber);
  const goldHolderOk = isValidGoldCardHolder(goldHolder);
  const goldMissing = goldApplied && (!goldNumberOk || !goldHolderOk);

  // Ref. doctor is compulsory for B2C New Orders (a picked existing doctor or a
  // freshly typed name). Optional in B2B.
  const refDoctorMissing =
    !isB2b &&
    (!refDoctor || (refDoctor.kind === 'new' && !refDoctor.name.trim()));

  // Every non-empty UPI line must carry a transaction reference so the receipt
  // is traceable. A UPI line with ₹0 has no transaction to reference yet.
  const txnMissing = payments.some(
    (p) => p.method === 'UPI' && Number(p.amount) > 0 && !p.ref.trim(),
  );

  // pageMounted gate — placed AFTER all hooks so hook count stays stable
  // across renders (Rules of Hooks). The hooks for pageMounted itself live
  // at the top of this component near useActionState.
  if (!pageMounted) {
    return (
      <div className="grid gap-4 text-sm lg:grid-cols-2">
        <div className="h-96 animate-pulse rounded-xl border border-foreground/5 bg-foreground/[0.04]" />
        <div className="h-96 animate-pulse rounded-xl border border-foreground/5 bg-foreground/[0.04]" />
      </div>
    );
  }

  function add(i: CatalogItemPublic) {
    setPicked((p) =>
      p.some((x) => x.id === i.id && x.kind === i.kind)
        ? p
        : [...p, { id: i.id, kind: i.kind, code: i.code, name: i.name }],
    );
  }
  function remove(id: number, kind: string) {
    setPicked((p) => p.filter((x) => !(x.id === id && x.kind === kind)));
    // If this item came from the catalog cart, remove it there too so the
    // nav badge (server-rendered) reflects the real cart count.
    const wasFromCart = initialItems.some(
      (i) => i.id === id && i.kind === kind,
    );
    if (wasFromCart) {
      removeFromCart(id, kind as Picked['kind']).then(() =>
        router.refresh(),
      );
    }
  }

  return (
    <form action={action} className="grid gap-4 text-sm lg:grid-cols-2">
      <input type="hidden" name="mcc" value={mcc} />
      <input type="hidden" name="b2b" value={isB2b ? '1' : ''} />
      <input type="hidden" name="itemsJson" value={JSON.stringify(picked)} />
      <input
        type="hidden"
        name="paymentsJson"
        value={JSON.stringify(
          // Submit only filled lines; drop the ref for Cash.
          payments
            .map((p) => ({
              method: p.method,
              amount: Math.round(Number(p.amount) || 0),
              ref: p.method !== 'Cash' ? p.ref.trim() : '',
            }))
            .filter((p) => p.amount > 0),
        )}
      />
      {/* Gold Card is B2C-only — only emit its fields outside B2B mode. */}
      {!isB2b && (
        <>
          <input type="hidden" name="goldCard" value={goldCard ? '1' : ''} />
          <input
            type="hidden"
            name="goldCardNumber"
            value={goldCard ? goldNumber.trim() : ''}
          />
          <input
            type="hidden"
            name="goldCardHolder"
            value={goldCard ? goldHolder.trim() : ''}
          />
        </>
      )}
      <input
        type="hidden"
        name="refDoctorJson"
        value={refDoctor ? JSON.stringify(refDoctor) : ''}
      />
      <input
        type="hidden"
        name="refCustomerJson"
        value={
          refCustomerText.trim()
            ? JSON.stringify({ kind: 'new', name: refCustomerText.trim() })
            : ''
        }
      />
      <input
        type="hidden"
        name="sidsJson"
        value={JSON.stringify(
          // SIDs are optional — submit only the groups the operator filled.
          groups
            .map((g) => ({
              sampleTypeId: g.sampleTypeId,
              vailid: (groupSids[g.sampleTypeId] ?? '').trim(),
            }))
            .filter((s) => s.vailid !== ''),
        )}
      />

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Patient &amp; sample</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 p-4 pt-0">
          <div className="space-y-0.5">
            <Label htmlFor="clientCode">Client code *</Label>
            <Combobox
              id="clientCode"
              items={units}
              value={mcc}
              onChange={setMcc}
              placeholder="Type client code or name…"
              // Client accounts mapped to a single MCC: pre-selected + locked.
              disabled={units.length === 1}
            />
            {units.length === 1 && (
              <p className="text-[11px] text-secondary/80">
                Locked to your Client code — you can only place orders for{' '}
                <span className="font-semibold text-secondary">{units[0].code}</span>.
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-0.5">
              <Label>Title</Label>
              <select
                name="title"
                suppressHydrationWarning
              className={sel}
                value={f.title}
                onChange={upd('title')}
              >
                {TITLES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="name">Patient name *</Label>
              <Input
                id="name"
                name="name"
                required
                maxLength={200}
                value={f.name}
                onChange={upd('name')}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-0.5">
              <Label htmlFor="age">Age *</Label>
              <Input
                id="age"
                name="age"
                type="number"
                required
                min={0}
                max={150}
                value={f.age}
                onChange={upd('age')}
              />
            </div>
            <div className="space-y-0.5">
              <Label>Unit</Label>
              <select
                name="ageType"
                suppressHydrationWarning
              className={sel}
                value={f.ageType}
                onChange={upd('ageType')}
              >
                <option value="1">Years</option>
                <option value="2">Months</option>
                <option value="3">Days</option>
              </select>
            </div>
            <div className="space-y-0.5">
              <Label>Gender</Label>
              <select
                name="gender"
                suppressHydrationWarning
              className={sel}
                value={f.gender}
                onChange={upd('gender')}
              >
                <option value="1">Male</option>
                <option value="2">Female</option>
                <option value="3">Other</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <MobileField
              value={f.mobile}
              onChange={(next) => setF((s) => ({ ...s, mobile: next }))}
              status={mobileStatus}
              onStatus={setMobileStatus}
            />
            <div className="space-y-0.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                maxLength={100}
                value={f.email}
                onChange={upd('email')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <Label htmlFor="refDoctor">Ref. doctor{!isB2b && ' *'}</Label>
              <CreatableCombobox
                id="refDoctor"
                items={doctorsItems}
                value={refDoctor}
                onChange={setRefDoctor}
                placeholder={
                  mcc === ''
                    ? 'Select a Client code first'
                    : refDataLoading
                      ? 'Loading…'
                      : doctorsItems.length === 0
                        ? 'No doctors on file — type to add'
                        : 'Search or add new doctor…'
                }
                disabled={mcc === ''}
              />
              {mcc !== '' && !refDataLoading && doctorsItems.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  No referrers on file for this Client yet — type a name to add one.
                </p>
              )}
            </div>
            <div className="space-y-0.5">
              <Label htmlFor="refCustomer">MRD + (IPD/OPD/ICU)</Label>
              <Input
                id="refCustomer"
                value={refCustomerText}
                onChange={(e) => setRefCustomerText(e.target.value)}
                placeholder={
                  mcc === ''
                    ? 'Select a Client code first'
                    : 'e.g. MRD-12345 OPD'
                }
                maxLength={100}
                disabled={mcc === ''}
              />
            </div>
          </div>

          <div className="space-y-0.5">
            <Label htmlFor="clinicalHistory">Clinical history</Label>
            <Textarea
              id="clinicalHistory"
              name="clinicalHistory"
              maxLength={500}
              rows={3}
              value={f.clinicalHistory}
              onChange={upd('clinicalHistory')}
            />
          </div>

          <div className="space-y-0.5">
            <Label htmlFor="clinicalFile">Clinical history PDF (optional)</Label>
            <input
              ref={fileRef}
              id="clinicalFile"
              name="clinicalFile"
              type="file"
              accept="application/pdf"
              suppressHydrationWarning
              onChange={(e) =>
                setClinicalFileName(e.target.files?.[0]?.name ?? null)
              }
              className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded file:border file:border-foreground/10 file:bg-muted file:px-2 file:py-1 file:text-xs file:text-foreground hover:file:bg-foreground/10"
            />
            {clinicalFileName && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate">{clinicalFileName}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (fileRef.current) fileRef.current.value = '';
                    setClinicalFileName(null);
                  }}
                  className="shrink-0 text-destructive hover:underline"
                >
                  remove
                </button>
              </p>
            )}
          </div>

          {/* Split payments — one line per method the patient pays with (e.g.
              part Cash + part UPI). Each becomes its own receipt. The first
              line auto-prefills to 50% of the total; the sum must meet the 50%
              floor. UPI lines need a transaction reference. */}
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <Label>Payment</Label>
              {effectiveTotal > 0 && (
                <span
                  className={`text-[11px] tabular-nums ${
                    belowMinPaid ? 'text-destructive' : 'text-muted-foreground'
                  }`}
                >
                  Collected ₹{paidSum} / ₹{effectiveTotal}
                  {minPaid > 0 ? ` · min ₹${minPaid} (50%)` : ''}
                </span>
              )}
            </div>

            {payments.map((p, idx) => {
              const lineUpiMissing =
                p.method === 'UPI' && Number(p.amount) > 0 && !p.ref.trim();
              return (
                <div
                  key={idx}
                  className="space-y-1.5 rounded-md border border-foreground/10 bg-foreground/[0.02] p-2"
                >
                  <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <div className="space-y-0.5">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Method
                      </Label>
                      <select
                        suppressHydrationWarning
                        className={sel}
                        value={p.method}
                        onChange={(e) => setPay(idx, 'method', e.target.value)}
                      >
                        {PAY_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-0.5">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Amount (₹)
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        value={p.amount}
                        onChange={(e) => {
                          setReceiptTouched(true);
                          setPay(idx, 'amount', e.target.value);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removePay(idx)}
                      disabled={payments.length === 1}
                      className="h-9 px-2 text-xs text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Remove payment line"
                    >
                      remove
                    </button>
                  </div>
                  {p.method !== 'Cash' && (
                    <div className="space-y-0.5">
                      <Input
                        type="text"
                        maxLength={50}
                        placeholder="UPI ref / cheque no. / card auth code…"
                        value={p.ref}
                        onChange={(e) => setPay(idx, 'ref', e.target.value)}
                        aria-invalid={lineUpiMissing}
                        suppressHydrationWarning
                      />
                      <p
                        className={`text-[10px] ${
                          lineUpiMissing
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {lineUpiMissing
                          ? 'Required for UPI — enter the transaction reference.'
                          : p.method === 'UPI'
                            ? 'UPI transaction reference (required).'
                            : 'Reference (optional) — shown in Accounts & the Excel export.'}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={addPay}
              className="text-xs font-medium text-primary hover:underline"
            >
              + Add payment method
            </button>

            <div className="space-y-0.5 pt-1">
              <Label htmlFor="discountAmount">Discount (₹)</Label>
              <Input
                id="discountAmount"
                name="discountAmount"
                type="number"
                min={0}
                max={maxDiscount}
                value={goldApplied ? '0' : f.discountAmount}
                disabled={goldApplied}
                onChange={upd('discountAmount')}
                onBlur={() => {
                  // Snap a too-large discount back down to the 20% cap.
                  if (effectiveTotal <= 0) return;
                  const v = Number(f.discountAmount);
                  if (Number.isFinite(v) && v > maxDiscount) {
                    setF((s) => ({ ...s, discountAmount: String(maxDiscount) }));
                  }
                }}
                aria-invalid={aboveMaxDiscount}
              />
              {effectiveTotal > 0 && (
                <p
                  className={`text-[10px] ${
                    aboveMaxDiscount ? 'text-destructive' : 'text-muted-foreground'
                  }`}
                >
                  {goldApplied
                    ? 'Disabled — the Gold Card already applies 50% off.'
                    : aboveMaxDiscount
                      ? `Max discount ₹${maxDiscount} (20%).`
                      : `Up to ₹${maxDiscount} (20%).`}
                </p>
              )}
            </div>

            {/* Gold Card (B2C only) — a button next to the Discount input that
                expands into the card inputs. Applying it charges the whole bill
                at 50% and stores the card at Telo table level. */}
            {!isB2b && (
              <div>
                <button
                  type="button"
                  aria-expanded={goldCard}
                  onClick={() => {
                    const next = !goldCard;
                    setGoldCard(next);
                    // Card is the discount — clear any manual one, and re-pin
                    // the prefilled "paid now" to 50% of the new total.
                    if (next) setF((s) => ({ ...s, discountAmount: '0' }));
                    setReceiptTouched(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    goldCard
                      ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                      : 'border-amber-500/30 bg-amber-500/[0.05] text-amber-300 hover:bg-amber-500/10'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Gold Card — 50% off
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform duration-300 ${
                      goldCard ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {/* Smoothly expand/collapse via grid-rows 0fr→1fr (animatable,
                    unlike height:auto). Inner wrapper must be overflow-hidden. */}
                <div
                  aria-hidden={!goldCard}
                  className={`grid transition-all duration-300 ease-out ${
                    goldCard
                      ? 'mt-2 grid-rows-[1fr] opacity-100'
                      : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/[0.05] p-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-0.5">
                          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Card number
                          </Label>
                          <Input
                            type="text"
                            maxLength={50}
                            placeholder="Gold Card number"
                            value={goldNumber}
                            tabIndex={goldCard ? undefined : -1}
                            onChange={(e) => setGoldNumber(e.target.value)}
                            aria-invalid={goldCard && !goldNumberOk}
                            suppressHydrationWarning
                          />
                        </div>
                        <div className="space-y-0.5">
                          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Card holder
                          </Label>
                          <Input
                            type="text"
                            maxLength={200}
                            placeholder="Card holder name"
                            value={goldHolder}
                            tabIndex={goldCard ? undefined : -1}
                            onChange={(e) => setGoldHolder(e.target.value)}
                            aria-invalid={goldCard && !goldHolderOk}
                            suppressHydrationWarning
                          />
                        </div>
                      </div>
                      <p
                        className={`text-[10px] ${
                          goldMissing ? 'text-destructive' : 'text-amber-300/80'
                        }`}
                      >
                        {goldMissing
                          ? !goldNumberOk
                            ? 'Enter a valid card number (min 4 characters).'
                            : 'Enter the card holder’s full name.'
                          : preview.total > 0
                            ? `Bill halved — total is now ₹${effectiveTotal} (was ₹${preview.total}).`
                            : 'Bill will be charged at 50%.'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Tests &amp; profiles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 p-4 pt-0">
          {initialItems.length > 0 && picked.length > 0 && picked.every(p => initialItems.some(i => i.id === p.id && i.kind === p.kind)) && (
            <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
              <span>
                <span className="font-semibold">{initialItems.length} test{initialItems.length === 1 ? '' : 's'}</span> pre-loaded from Catalog
              </span>
              <button
                type="button"
                className="underline opacity-70 hover:opacity-100"
                onClick={() => {
                  setPicked([]);
                  // Remove every pre-loaded item from the Redis cart and
                  // refresh the nav badge.
                  Promise.all(
                    initialItems.map((i) =>
                      removeFromCart(i.id, i.kind as Picked['kind']),
                    ),
                  ).then(() => router.refresh());
                }}
              >
                Clear
              </button>
            </div>
          )}
          {mcc === '' && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              Select a Client code before registering — rates shown are MRP.
            </p>
          )}
          <Input
            placeholder="Search tests, profiles or packages…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {results.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-lg border border-foreground/10 bg-card">
              {results.map((r) => (
                <button
                  type="button"
                  key={`${r.kind}-${r.id}`}
                  onClick={() => add(r)}
                  className="flex w-full items-center justify-between border-b border-foreground/5 px-3 py-2 text-left text-sm last:border-0 hover:bg-foreground/5"
                >
                  <span>
                    <span className="font-mono text-xs">{r.code}</span>{' '}
                    {r.name}
                  </span>
                  <Badge
                    variant={
                      r.kind === 'master'
                        ? 'default'
                        : r.kind === 'profile'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {r.kind === 'master' ? 'package' : r.kind}
                  </Badge>
                </button>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-foreground/5 bg-card">
            <div className="border-b border-foreground/5 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
              Selected ({picked.length})
            </div>
            {isB2b && picked.length > 0 && (
              // Header only on sm+ — on mobile each row carries its own labels.
              <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 border-b border-foreground/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
                <span>Test</span>
                <span className="text-right">MRP</span>
                <span className="text-right">Client rate</span>
                <span className="text-right">Profit&nbsp;%</span>
                <span className="text-right">&nbsp;</span>
              </div>
            )}
            {picked.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No tests added yet.
              </p>
            ) : isB2b ? (
              picked.map((it) => {
                const pl = preview.lines.find(
                  (l) => l.id === it.id && l.kind === it.kind,
                );
                const mrp = pl?.mrp ?? null;
                const cr = pl?.clientRate ?? null;
                const profitPct =
                  mrp != null && mrp > 0 && cr != null
                    ? Math.round(((mrp - cr) / mrp) * 100)
                    : null;
                return (
                  <div
                    key={`${it.kind}-${it.id}`}
                    className="border-b border-foreground/5 px-3 py-2 text-sm last:border-0 sm:grid sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-center sm:gap-x-3"
                  >
                    <span className="block min-w-0">
                      <span className="font-mono text-xs">{it.code}</span>{' '}
                      {it.name}
                    </span>
                    {/* sm:contents lets these four become direct grid cells on
                        desktop; on mobile they wrap into a labelled row below. */}
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs sm:mt-0 sm:contents">
                      <span className="tabular-nums sm:text-right">
                        <span className="text-muted-foreground sm:hidden">MRP </span>
                        {mrp != null ? `₹${mrp}` : '…'}
                      </span>
                      <span className="tabular-nums text-muted-foreground sm:text-right">
                        <span className="sm:hidden">Client </span>
                        {cr != null ? `₹${cr}` : '…'}
                      </span>
                      <span className="tabular-nums text-emerald-400 sm:text-right">
                        <span className="sm:hidden">Profit </span>
                        {profitPct != null ? `${profitPct}%` : '—'}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(it.id, it.kind)}
                        className="ml-auto text-xs text-destructive hover:underline sm:ml-0 sm:text-right"
                      >
                        remove
                      </button>
                    </span>
                  </div>
                );
              })
            ) : (
              picked.map((it) => {
                const pl = preview.lines.find(
                  (l) => l.id === it.id && l.kind === it.kind,
                );
                return (
                  <div
                    key={`${it.kind}-${it.id}`}
                    className="flex items-center justify-between border-b border-foreground/5 px-3 py-2 text-sm last:border-0"
                  >
                    <span>
                      <span className="font-mono text-xs">{it.code}</span>{' '}
                      {it.name}
                    </span>
                    <span className="flex items-center gap-3">
                      <span>{pl?.rate != null ? `₹${pl.rate}` : '…'}</span>
                      <button
                        type="button"
                        onClick={() => remove(it.id, it.kind)}
                        className="text-xs text-destructive hover:underline"
                      >
                        remove
                      </button>
                    </span>
                  </div>
                );
              })
            )}
            <div className="flex items-center justify-between border-t border-foreground/5 px-3 py-2 text-sm font-semibold">
              <span>
                Total
                {isB2b
                  ? ' (patient pays MRP)'
                  : goldApplied
                    ? ' (Gold Card · 50% off)'
                    : ''}
              </span>
              <span className="flex items-center gap-3">
                {isB2b &&
                  (() => {
                    const sumMrp = preview.lines.reduce((s, l) => s + (l.mrp ?? 0), 0);
                    const sumCr = preview.lines.reduce(
                      (s, l) => s + (l.clientRate ?? 0),
                      0,
                    );
                    const agg =
                      sumMrp > 0 ? Math.round(((sumMrp - sumCr) / sumMrp) * 100) : 0;
                    return (
                      <span className="text-xs font-normal text-emerald-400">
                        {agg}% profit
                      </span>
                    );
                  })()}
                {goldApplied && preview.total !== effectiveTotal && (
                  <span className="text-xs font-normal text-muted-foreground line-through">
                    ₹{preview.total}
                  </span>
                )}
                <span className={goldApplied ? 'text-amber-300' : undefined}>
                  ₹{effectiveTotal}
                </span>
              </span>
            </div>
          </div>

          {groups.length > 0 && (() => {
            const trimmed = groups.map(
              (g) => (groupSids[g.sampleTypeId] ?? '').trim(),
            );
            const enteredCount = trimmed.filter((v) => v.length > 0).length;
            return (
              <div className="rounded-md border border-foreground/10 bg-foreground/[0.02]">
                <button
                  type="button"
                  onClick={() => setSidsOpen((o) => !o)}
                  aria-expanded={sidsOpen}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                >
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Sample IDs · {groups.length} barcode
                    {groups.length === 1 ? '' : 's'} needed
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {enteredCount > 0
                        ? `${enteredCount} entered · optional`
                        : 'Optional'}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                        sidsOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </span>
                </button>
                <div className={sidsOpen ? 'space-y-2 px-3 pb-3' : 'hidden'}>
                  <p className="rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] text-muted-foreground">
                    Optional — leave blank and the lab technician adds them later
                    from the New Order worklist.
                  </p>
                  {groups.map((g, idx) => {
                    const me = trimmed[idx];
                    const clientDup =
                      !!me && trimmed.filter((v) => v === me).length > 1;
                    return (
                      <SidField
                        key={g.sampleTypeId}
                        group={g}
                        value={groupSids[g.sampleTypeId] ?? ''}
                        onChange={(next) =>
                          setGroupSids((p) => ({
                            ...p,
                            [g.sampleTypeId]: next,
                          }))
                        }
                        status={groupStatus[g.sampleTypeId] ?? 'idle'}
                        onStatus={(s) =>
                          setGroupStatus((p) => ({
                            ...p,
                            [g.sampleTypeId]: s,
                          }))
                        }
                        clientDup={clientDup}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {state.error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}

          {(() => {
            const trimmed = groups.map(
              (g) => (groupSids[g.sampleTypeId] ?? '').trim(),
            );
            // SIDs are OPTIONAL — register with none, some, or all. Only a
            // *filled* SID that is invalid blocks submission.
            const filledCount = trimmed.filter((v) => v.length > 0).length;
            const anyTaken = groups.some(
              (g) => groupStatus[g.sampleTypeId] === 'taken',
            );
            const anyChecking = groups.some(
              (g) => groupStatus[g.sampleTypeId] === 'checking',
            );
            const anyError = groups.some(
              (g) => groupStatus[g.sampleTypeId] === 'error',
            );
            const hasClientDup =
              new Set(trimmed.filter(Boolean)).size <
              trimmed.filter(Boolean).length;
            const coreMissing =
              !f.name.trim() ||
              !f.age.trim() ||
              !f.mobile.trim() ||
              f.mobile.trim().length < 10;
            // The mobile usage cap blocks like a taken SID: at the limit,
            // while checking, or unverifiable — never save on an unknown.
            const mobileBlocked = mobileStatus === 'blocked';
            const mobileBusy =
              mobileStatus === 'checking' || mobileStatus === 'error';
            const blocked =
              pending ||
              picked.length === 0 ||
              mcc === '' ||
              groups.length === 0 ||
              anyTaken ||
              anyChecking ||
              anyError ||
              hasClientDup ||
              coreMissing ||
              mobileBlocked ||
              mobileBusy ||
              belowMinPaid ||
              aboveMaxDiscount ||
              txnMissing ||
              goldMissing ||
              refDoctorMissing;
            const label = pending
              ? 'Registering…'
              : mcc === ''
                ? 'Select a Client code'
                : coreMissing
                  ? 'Patient details required'
                  : refDoctorMissing
                    ? 'Ref. doctor required'
                  : mobileBlocked
                    ? 'Mobile number limit reached'
                    : mobileStatus === 'checking'
                      ? 'Checking mobile number…'
                      : mobileStatus === 'error'
                        ? 'Could not verify mobile number'
                        : groups.length === 0
                    ? 'Add tests to continue'
                    : anyTaken
                      ? 'Sample ID already exists'
                      : hasClientDup
                        ? 'Duplicate Sample IDs in form'
                        : anyChecking
                          ? 'Checking Sample IDs…'
                          : anyError
                            ? 'Could not verify Sample IDs'
                            : belowMinPaid
                              ? `Collect at least ₹${minPaid} (50%)`
                              : aboveMaxDiscount
                                ? `Discount can't exceed ₹${maxDiscount} (20%)`
                                : txnMissing
                                  ? 'Enter UPI transaction reference'
                                  : goldMissing
                                    ? 'Enter Gold Card details'
                                    : `Review & register · ₹${effectiveTotal}`;

            // Two-step submit. The first button only flips into review mode
            // (no commit); the operator confirms or goes back from the panel.
            if (!reviewing) {
              return (
                <Button
                  type="button"
                  className="w-full"
                  disabled={blocked}
                  onClick={() => setReviewing(true)}
                >
                  {label}
                </Button>
              );
            }

            const mccUnit = units.find((u) => u.id === mcc);
            const sidsByGroup = groups.map((g) => ({
              group: g,
              vailid: (groupSids[g.sampleTypeId] ?? '').trim(),
            }));

            return (
              <div className="card-light space-y-3 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-50">
                  Review — confirm to register
                </p>

                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-zinc-800">
                  <span className="text-zinc-500">Client</span>
                  <span>
                    {mccUnit
                      ? `${mccUnit.name ?? mccUnit.code} (${mccUnit.code})`
                      : '—'}
                  </span>
                  <span className="text-zinc-500">Patient</span>
                  <span>
                    {f.title ? `${f.title} ` : ''}
                    {f.name || '—'}
                    {f.age ? ` · ${f.age}` : ''}
                    {f.gender === '1'
                      ? ' M'
                      : f.gender === '2'
                        ? ' F'
                        : ''}
                  </span>
                  {f.mobile && (
                    <>
                      <span className="text-zinc-500">Mobile</span>
                      <span>{f.mobile}</span>
                    </>
                  )}
                  {refDoctor && (
                    <>
                      <span className="text-zinc-500">Ref. doctor</span>
                      <span>
                        {refDoctor.kind === 'new' ? (
                          <>
                            {refDoctor.name}{' '}
                            <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                              new
                            </span>
                          </>
                        ) : (
                          refData?.doctors.find((d) => d.id === refDoctor.id)?.name ?? '—'
                        )}
                      </span>
                    </>
                  )}
                  {refCustomerText.trim() && (
                    <>
                      <span className="text-zinc-500">MRD + visit</span>
                      <span>{refCustomerText.trim()}</span>
                    </>
                  )}
                  {clinicalFileName && (
                    <>
                      <span className="text-zinc-500">Clinical PDF</span>
                      <span className="truncate">{clinicalFileName}</span>
                    </>
                  )}
                  <span className="text-zinc-500">Tests</span>
                  <span>
                    {picked.length} item(s) · ₹{effectiveTotal}
                    {goldApplied && (
                      <span className="text-zinc-400">
                        {' '}(was ₹{preview.total})
                      </span>
                    )}
                  </span>
                  {goldApplied && (
                    <>
                      <span className="text-zinc-500">Gold Card</span>
                      <span>
                        {goldNumber.trim()} · {goldHolder.trim()} ·{' '}
                        <span className="font-medium text-amber-600">
                          50% off
                        </span>
                      </span>
                    </>
                  )}
                  <span className="text-zinc-500">Payment</span>
                  <span>
                    {payments
                      .filter((p) => Number(p.amount) > 0)
                      .map(
                        (p) => `${p.method} ₹${Math.round(Number(p.amount))}`,
                      )
                      .join(' + ') || 'nothing collected'}
                    {' · paid ₹'}
                    {paidSum}
                    {!goldApplied && Number(f.discountAmount) > 0
                      ? ` · disc ₹${f.discountAmount}`
                      : ''}
                  </span>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium text-zinc-500">
                    Sample IDs ·{' '}
                    {sidsByGroup.filter((s) => s.vailid).length}/{groups.length}{' '}
                    entered
                  </p>
                  {sidsByGroup.map(({ group, vailid }) => (
                    <div
                      key={group.sampleTypeId}
                      className="flex items-baseline justify-between gap-2 rounded border border-black/10 bg-black/5 px-2 py-1 text-sm"
                    >
                      <span>
                        <span className="font-medium">
                          {group.sampleTypeName}
                        </span>{' '}
                        <span className="font-mono text-xs text-muted-foreground">
                          {group.csvCodes}
                        </span>
                      </span>
                      {vailid ? (
                        <span className="font-mono">{vailid}</span>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">
                          added later
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={pending}
                    onClick={() => setReviewing(false)}
                  >
                    ← Back to edit
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={blocked}
                  >
                    {pending
                      ? 'Registering…'
                      : `Confirm & register · ₹${effectiveTotal}`}
                  </Button>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </form>
  );
}
