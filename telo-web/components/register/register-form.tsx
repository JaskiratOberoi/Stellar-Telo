'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
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
import type { SampleGroup } from '@/db/sp/previewSampleGroups';
import { PAY_METHODS } from '@/lib/payment-methods';
import type { ScopedMcc } from '@/db/read/mccUnits';
import type { CatalogItem } from '@/domain/catalog/catalog.types';
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Master', 'Baby', 'Baby of', 'Dr'];
const initial: RegisterState = { error: null };
const sel =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm';

type Picked = { id: number; kind: 'test' | 'profile'; code: string; name: string };

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
  paymentType: string;
  receiptAmount: string;
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
  paymentType: 'Cash',
  receiptAmount: '0',
  discountAmount: '0',
};

export function RegisterForm({ units }: { units: ScopedMcc[] }) {
  // Render the form CLIENT-ONLY: browser extensions (e.g. Shark form-filler)
  // inject custom wrappers/attrs into the SSR HTML before React hydrates,
  // producing a new tree mismatch every time we patch an old one. The actual
  // gate is at the END of the hook list (search for "pageMounted gate") so
  // we never violate Rules of Hooks by varying hook count across renders.
  const [pageMounted, setPageMounted] = useState(false);
  useEffect(() => setPageMounted(true), []);

  const [state, action, pending] = useActionState(registerOrder, initial);

  const [mcc, setMcc] = useState<number | ''>(
    units.length === 1 ? units[0].id : '',
  );
  const [f, setF] = useState<Fields>(DEFAULTS);
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

  // Ref. doctor / Ref. customer use structured CreatableValue state — picked
  // existing id or fresh name. Serialized into refDoctorJson/refCustomerJson
  // hidden inputs at submit.
  const [refDoctor, setRefDoctor] = useState<CreatableValue>(null);
  const [refCustomer, setRefCustomer] = useState<CreatableValue>(null);

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
      setRefCustomer(null);
      return;
    }
    // Clear any prior selection — a doctor mapped to MCC A must not silently
    // carry over to MCC B.
    setRefDoctor(null);
    setRefCustomer(null);
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
  const customersItems = (refData?.customers ?? []).map((c) => ({
    id: c.id,
    code: c.code ?? '',
    name: c.name,
  }));

  const [picked, setPicked] = useState<Picked[]>([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CatalogItem[]>([]);
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
  const groupsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        const next: Record<number, 'idle' | 'checking' | 'available' | 'taken'> = {};
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

  useEffect(() => {
    if (picked.length === 0) {
      setPreview({ lines: [], total: 0 });
      return;
    }
    // Rates are MRP — centre-independent — so the preview resolves even
    // before a Client code is picked.
    startPreview(async () => setPreview(await previewOrder(picked)));
  }, [picked]);

  // pageMounted gate — placed AFTER all hooks so hook count stays stable
  // across renders (Rules of Hooks). The hooks for pageMounted itself live
  // at the top of this component near useActionState.
  if (!pageMounted) {
    return (
      <div className="grid gap-4 text-sm lg:grid-cols-2">
        <div className="h-96 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-96 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    );
  }

  function add(i: CatalogItem) {
    setPicked((p) =>
      p.some((x) => x.id === i.id && x.kind === i.kind)
        ? p
        : [...p, { id: i.id, kind: i.kind, code: i.code, name: i.name }],
    );
  }
  function remove(id: number, kind: string) {
    setPicked((p) => p.filter((x) => !(x.id === id && x.kind === kind)));
  }

  return (
    <form action={action} className="grid gap-4 text-sm lg:grid-cols-2">
      <input type="hidden" name="mcc" value={mcc} />
      <input type="hidden" name="itemsJson" value={JSON.stringify(picked)} />
      <input
        type="hidden"
        name="refDoctorJson"
        value={refDoctor ? JSON.stringify(refDoctor) : ''}
      />
      <input
        type="hidden"
        name="refCustomerJson"
        value={refCustomer ? JSON.stringify(refCustomer) : ''}
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
            />
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
            <div className="space-y-0.5">
              <Label htmlFor="mobile">Mobile *</Label>
              <Input
                id="mobile"
                name="mobile"
                required
                inputMode="tel"
                minLength={10}
                maxLength={20}
                value={f.mobile}
                onChange={upd('mobile')}
              />
            </div>
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
              <Label htmlFor="refDoctor">Ref. doctor</Label>
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
              <Label htmlFor="refCustomer">Ref. customer</Label>
              <CreatableCombobox
                id="refCustomer"
                items={customersItems}
                value={refCustomer}
                onChange={setRefCustomer}
                placeholder={
                  mcc === ''
                    ? 'Select a Client code first'
                    : refDataLoading
                      ? 'Loading…'
                      : customersItems.length === 0
                        ? 'No customers on file — type to add'
                        : 'Search or add new customer…'
                }
                disabled={mcc === ''}
              />
              {mcc !== '' && !refDataLoading && customersItems.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  No referrers on file for this Client yet — type a name to add one.
                </p>
              )}
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
              className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded file:border file:border-input file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-foreground hover:file:bg-accent"
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

          <div className="grid grid-cols-3 gap-2 border-t pt-3">
            <div className="space-y-0.5">
              <Label>Payment</Label>
              <select
                name="paymentType"
                suppressHydrationWarning
              className={sel}
                value={f.paymentType}
                onChange={upd('paymentType')}
              >
                {PAY_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-0.5">
              <Label htmlFor="receiptAmount">Paid now (₹)</Label>
              <Input
                id="receiptAmount"
                name="receiptAmount"
                type="number"
                min={0}
                value={f.receiptAmount}
                onChange={upd('receiptAmount')}
              />
            </div>
            <div className="space-y-0.5">
              <Label htmlFor="discountAmount">Discount (₹)</Label>
              <Input
                id="discountAmount"
                name="discountAmount"
                type="number"
                min={0}
                value={f.discountAmount}
                onChange={upd('discountAmount')}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Tests &amp; profiles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 p-4 pt-0">
          {mcc === '' && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              Select a Client code before registering — rates shown are MRP.
            </p>
          )}
          <Input
            placeholder="Search tests or profiles…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {results.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border">
              {results.map((r) => (
                <button
                  type="button"
                  key={`${r.kind}-${r.id}`}
                  onClick={() => add(r)}
                  className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent"
                >
                  <span>
                    <span className="font-mono text-xs">{r.code}</span>{' '}
                    {r.name}
                  </span>
                  <Badge
                    variant={r.kind === 'profile' ? 'secondary' : 'outline'}
                  >
                    {r.kind}
                  </Badge>
                </button>
              ))}
            </div>
          )}

          <div className="rounded-md border">
            <div className="border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
              Selected ({picked.length})
            </div>
            {picked.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No tests added yet.
              </p>
            ) : (
              picked.map((it) => {
                const pl = preview.lines.find(
                  (l) => l.id === it.id && l.kind === it.kind,
                );
                return (
                  <div
                    key={`${it.kind}-${it.id}`}
                    className="flex items-center justify-between border-b px-3 py-2 text-sm last:border-0"
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
            <div className="flex items-center justify-between border-t px-3 py-2 text-sm font-semibold">
              <span>Total</span>
              <span>₹{preview.total}</span>
            </div>
          </div>

          {groups.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sample IDs · {groups.length} barcode{groups.length === 1 ? '' : 's'} needed
              </p>
              <p className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[11px] text-blue-700">
                Optional — leave blank and the lab technician adds them later
                from the New Order worklist.
              </p>
              {(() => {
                const trimmed = groups.map(
                  (g) => (groupSids[g.sampleTypeId] ?? '').trim(),
                );
                return groups.map((g, idx) => {
                  const me = trimmed[idx];
                  const clientDup =
                    !!me && trimmed.filter((v) => v === me).length > 1;
                  return (
                    <SidField
                      key={g.sampleTypeId}
                      group={g}
                      value={groupSids[g.sampleTypeId] ?? ''}
                      onChange={(next) =>
                        setGroupSids((p) => ({ ...p, [g.sampleTypeId]: next }))
                      }
                      status={groupStatus[g.sampleTypeId] ?? 'idle'}
                      onStatus={(s) =>
                        setGroupStatus((p) => ({ ...p, [g.sampleTypeId]: s }))
                      }
                      clientDup={clientDup}
                    />
                  );
                });
              })()}
            </div>
          )}

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
            const hasClientDup =
              new Set(trimmed.filter(Boolean)).size <
              trimmed.filter(Boolean).length;
            const coreMissing =
              !f.name.trim() ||
              !f.age.trim() ||
              !f.mobile.trim() ||
              f.mobile.trim().length < 10;
            const blocked =
              pending ||
              picked.length === 0 ||
              mcc === '' ||
              groups.length === 0 ||
              anyTaken ||
              anyChecking ||
              hasClientDup ||
              coreMissing;
            const label = pending
              ? 'Registering…'
              : mcc === ''
                ? 'Select a Client code'
                : coreMissing
                  ? 'Patient details required'
                  : groups.length === 0
                    ? 'Add tests to continue'
                    : anyTaken
                      ? 'Sample ID already exists'
                      : hasClientDup
                        ? 'Duplicate Sample IDs in form'
                        : anyChecking
                          ? 'Checking Sample IDs…'
                          : `Review & register · ₹${preview.total}`;

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
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Review — confirm to register
                </p>

                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <span className="text-muted-foreground">Client</span>
                  <span>
                    {mccUnit
                      ? `${mccUnit.name ?? mccUnit.code} (${mccUnit.code})`
                      : '—'}
                  </span>
                  <span className="text-muted-foreground">Patient</span>
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
                      <span className="text-muted-foreground">Mobile</span>
                      <span>{f.mobile}</span>
                    </>
                  )}
                  {refDoctor && (
                    <>
                      <span className="text-muted-foreground">Ref. doctor</span>
                      <span>
                        {refDoctor.kind === 'new' ? (
                          <>
                            {refDoctor.name}{' '}
                            <span className="ml-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-blue-700">
                              new
                            </span>
                          </>
                        ) : (
                          refData?.doctors.find((d) => d.id === refDoctor.id)?.name ?? '—'
                        )}
                      </span>
                    </>
                  )}
                  {refCustomer && (
                    <>
                      <span className="text-muted-foreground">Ref. customer</span>
                      <span>
                        {refCustomer.kind === 'new' ? (
                          <>
                            {refCustomer.name}{' '}
                            <span className="ml-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-blue-700">
                              new
                            </span>
                          </>
                        ) : (
                          refData?.customers.find((c) => c.id === refCustomer.id)?.name ?? '—'
                        )}
                      </span>
                    </>
                  )}
                  {clinicalFileName && (
                    <>
                      <span className="text-muted-foreground">Clinical PDF</span>
                      <span className="truncate">{clinicalFileName}</span>
                    </>
                  )}
                  <span className="text-muted-foreground">Tests</span>
                  <span>{picked.length} item(s) · ₹{preview.total}</span>
                  <span className="text-muted-foreground">Payment</span>
                  <span>
                    {f.paymentType} · paid ₹{f.receiptAmount || 0}
                    {Number(f.discountAmount) > 0
                      ? ` · disc ₹${f.discountAmount}`
                      : ''}
                  </span>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Sample IDs ·{' '}
                    {sidsByGroup.filter((s) => s.vailid).length}/{groups.length}{' '}
                    entered
                  </p>
                  {sidsByGroup.map(({ group, vailid }) => (
                    <div
                      key={group.sampleTypeId}
                      className="flex items-baseline justify-between gap-2 rounded border bg-background px-2 py-1 text-sm"
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
                      : `Confirm & register · ₹${preview.total}`}
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
