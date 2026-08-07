'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { currentUser } from '@/auth/session';
import { requireCapability, requireCapabilityForMcc } from '@/auth/guards';
import { hasCapability } from '@/auth/rbac';
import { loadCatalog, filterCatalog } from '@/db/read/catalog';
import {
  clientCodeForMcc,
  loadCustomTestsForClientCode,
  loadCustomTestForClient,
  type CustomTestPublic,
} from '@/db/read/customTests';
import { fetchMrpOnly } from '@/db/read/teloUsers';
import {
  fetchDoctorsForMcc,
  fetchCustomersForMcc,
  invalidateRefDataCache,
  type RefEntity,
} from '@/db/read/refData';
import { sidExists } from '@/db/read/sid';
import { countMobileUsage } from '@/db/read/mobileUsage';
import { MAX_PATIENTS_PER_MOBILE } from '@/lib/limits';
import { resolveRatesBatch } from '@/db/sp/resolveRate';
import { createOrder } from '@/db/sp/createOrder';
import { PAY_METHODS, type PayMethod } from '@/lib/payment-methods';
import { discountCapPct, discountCapLabel, discountableTotal } from '@/lib/discountPolicy';
import {
  isValidGoldCardNumber,
  isValidGoldCardHolder,
} from '@/lib/gold-card';
import {
  previewSampleGroups,
  type SampleGroup,
} from '@/db/sp/previewSampleGroups';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import {
  toPublicCatalogItem,
  type CatalogItemPublic,
} from '@/domain/catalog/catalog.types';
import { clearCart } from '@/db/cartStore';

export interface RefDataForMcc {
  doctors: RefEntity[];
  customers: RefEntity[];
}

/**
 * Per-MCC referrer fetch for the New Order form. Server-side filters by the
 * doctor's/customer's pcc_code (= owning MCC id), so the comboboxes only ever
 * surface referrers that belong to the selected Client code. Auth-gated and
 * scope-validated against the calling user's MCC scope.
 */
export async function fetchRefDataAction(mcc: number): Promise<RefDataForMcc> {
  if (!Number.isInteger(mcc) || mcc <= 0) return { doctors: [], customers: [] };
  try {
    await requireCapabilityForMcc('order:create', mcc);
  } catch {
    return { doctors: [], customers: [] };
  }
  const [doctors, customers] = await Promise.all([
    fetchDoctorsForMcc(mcc),
    fetchCustomersForMcc(mcc),
  ]);
  return { doctors, customers };
}

/**
 * Debounced test/profile search for the registration picker.
 *
 * Gated by `order:create` — only roles that can place an order can read the
 * catalogue. Returns the client-safe shape so internal CT/cost pricing never
 * crosses the RSC boundary (was leaking via the full CatalogItem before).
 */
export async function searchCatalogAction(
  q: string,
  kind: 'all' | 'test' | 'profile' | 'master' = 'all',
): Promise<CatalogItemPublic[]> {
  try {
    await requireCapability('order:create');
  } catch {
    return [];
  }
  const all = await loadCatalog();
  return filterCatalog(all, q, kind, 30).map(toPublicCatalogItem);
}

/**
 * Search Telo-only ("custom") tests offered for the selected client (MCC) —
 * e.g. "Glucose - External" for MDCARE. Scoped by the MCC's client code so a
 * custom test only surfaces for the client it's configured for. Gated by
 * `order:create` for that MCC. Returns [] for an out-of-scope / unknown MCC.
 */
export async function searchCustomTestsAction(
  q: string,
  mcc: number,
): Promise<CustomTestPublic[]> {
  if (!Number.isInteger(mcc) || mcc <= 0) return [];
  try {
    await requireCapabilityForMcc('order:create', mcc);
  } catch {
    return [];
  }
  const clientCode = await clientCodeForMcc(mcc);
  if (!clientCode) return [];
  const all = await loadCustomTestsForClientCode(clientCode);
  const needle = (q ?? '').trim().toLowerCase();
  const out = needle
    ? all.filter(
        (t) =>
          t.name.toLowerCase().includes(needle) ||
          t.code.toLowerCase().includes(needle),
      )
    : all;
  return out.slice(0, 30);
}

/**
 * Real-time SID duplicate check. Auth-gated, read-only. Shared by the New Order
 * form (callers with `order:create`) AND the lab Accession page (technicians
 * with `order:accession`), so it accepts EITHER capability — gating on
 * `order:create` alone made every check return 'empty' for technicians, which
 * the field then rendered as a false "✓ Available".
 *
 * Uses a GLOBAL existence check (not MCC-scoped): vailid uniqueness in Noble is
 * enforced globally by trigger_PreventDuplicate and the create-order / add-sids
 * SPs reject any vailid that exists anywhere in tbl_med_mcc_patient_samples. A
 * scoped check would falsely report a SID owned by another centre as
 * "available" and let the operator enter a value the write path then rejects —
 * exactly the Telo-vs-LIS conflict this feedback exists to prevent. The only
 * thing a global check "leaks" is that some numeric SID is in use somewhere,
 * which is acceptable for this internal tool. 'taken' stays advisory — the SP +
 * trigger remain the hard guarantee on submit.
 *
 * Returns 'error' (not 'empty') when the lookup can't run, so the caller can
 * keep the field neutral instead of showing a green "available".
 */
export async function checkSid(
  sid: string,
): Promise<{ status: 'available' | 'taken' | 'empty' | 'error' }> {
  const v = (sid ?? '').trim();
  if (!v) return { status: 'empty' };
  const user = await currentUser();
  if (
    !user ||
    !(
      hasCapability(user.caps, 'order:create') ||
      hasCapability(user.caps, 'order:accession')
    )
  ) {
    return { status: 'error' };
  }
  try {
    return { status: (await sidExists(v)) ? 'taken' : 'available' };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Real-time mobile-number usage check for the New Order form. A mobile number
 * may be attached to at most MAX_PATIENTS_PER_MOBILE Telo-registered patients;
 * the form shows the running count as the receptionist types and blocks the
 * submit at the limit. Advisory only — registerOrder re-checks and
 * usp_telo_create_order is the hard guarantee, so a race between two open
 * forms still cannot exceed the limit by more than the in-flight overlap.
 *
 * Returns 'error' (never a fake 'ok') when the lookup can't run, so the field
 * blocks saving instead of silently waving a maxed-out number through.
 */
export async function checkMobileUsage(
  mobile: string,
): Promise<{ status: 'ok' | 'blocked' | 'empty' | 'error'; count: number }> {
  const v = (mobile ?? '').trim();
  if (v.length < 10) return { status: 'empty', count: 0 };
  const user = await currentUser();
  if (!user || !hasCapability(user.caps, 'order:create')) {
    return { status: 'error', count: 0 };
  }
  try {
    const count = await countMobileUsage(v);
    return {
      status: count >= MAX_PATIENTS_PER_MOBILE ? 'blocked' : 'ok',
      count,
    };
  } catch {
    return { status: 'error', count: 0 };
  }
}

export type ItemKind = 'test' | 'profile' | 'master';

/** Maps a catalog item kind to the rate-resolver's discriminated id field. */
function toResolveItem(it: { id: number; kind: ItemKind }) {
  return {
    testMasterId: it.kind === 'test' ? it.id : null,
    profileCode: it.kind === 'profile' ? it.id : null,
    masterCode: it.kind === 'master' ? it.id : null,
  };
}

export interface PreviewLine {
  id: number;
  kind: ItemKind;
  code: string;
  name: string;
  /** The price this line bills at: the client rate-list price in New Order
   *  mode, or the MRP in B2B mode. The Total and the payment floor use this. */
  rate: number | null;
  source: string;
  /** Catalogue MRP (patient price). Always populated for the B2B view. */
  mrp: number | null;
  /** The client's rate-list price (what we charge the client). B2B display:
   *  Profit % = (mrp − clientRate) / mrp. Null when no rate list applies. */
  clientRate: number | null;
}
export interface PreviewResult {
  lines: PreviewLine[];
  total: number;
}

/** Build a `${kind}:${id}` → MRP map from the cached catalogue. */
async function mrpMapFor(
  items: { id: number; kind: ItemKind }[],
): Promise<Map<string, number | null>> {
  const cat = await loadCatalog();
  const byKey = new Map<string, number | null>();
  for (const c of cat) byKey.set(`${c.kind}:${c.id}`, c.mrp ?? null);
  const out = new Map<string, number | null>();
  for (const it of items) {
    const k = `${it.kind}:${it.id}`;
    out.set(k, byKey.get(k) ?? null);
  }
  return out;
}

/**
 * Live sample-type grouping for the New Order form. Returns one group per
 * distinct sample type the order needs; the form renders one SID input per
 * group, labeled by sample-type name and showing the codes in each bucket.
 */
export async function previewSampleGroupsAction(
  items: { id: number; kind: ItemKind; code: string; name: string }[],
): Promise<SampleGroup[]> {
  const user = await currentUser();
  if (!user) return [];
  if (items.length === 0) return [];
  return previewSampleGroups(items);
}

/**
 * Live, server-authoritative price preview for the selected items, resolved
 * against the Client's assigned rate list. Pass the selected MCC so the
 * preview matches what the order will actually bill (createOrder re-resolves
 * with the same two-tier logic). `mcc` null → MRP-only estimate (e.g. a
 * multi-MCC operator who hasn't picked a Client code yet).
 *
 * One batched lookup for all lines (previously: N sequential round-trips per
 * preview, each one a WAN hop to the India SQL server).
 */
export async function previewOrder(
  mcc: number | null,
  items: { id: number; kind: ItemKind; code: string; name: string }[],
  b2b = false,
): Promise<PreviewResult> {
  const user = await currentUser();
  if (!user) return { lines: [], total: 0 };
  if (items.length === 0) return { lines: [], total: 0 };

  const [rates, mrpByKey] = await Promise.all([
    resolveRatesBatch(
      mcc != null && Number.isInteger(mcc) ? mcc : null,
      items.map(toResolveItem),
    ),
    mrpMapFor(items),
  ]);
  const lines: PreviewLine[] = items.map((it, idx) => {
    const rr = rates[idx];
    const mrp = mrpByKey.get(`${it.kind}:${it.id}`) ?? null;
    // In B2B mode the bill is charged at MRP (patient price); the rate-list
    // value (the client's cost) is surfaced separately for the margin display.
    return {
      ...it,
      rate: b2b ? mrp : rr.rate,
      source: b2b ? 'mrp' : rr.source,
      mrp,
      clientRate: rr.rate,
    };
  });
  const total = lines.reduce((s, l) => s + (l.rate ?? 0), 0);
  return { lines, total };
}

const itemSchema = z.object({
  id: z.coerce.number().int().positive(),
  kind: z.enum(['test', 'profile', 'master']),
  code: z.string(),
  name: z.string(),
});

// A Telo-only custom line the operator added — identity + count only. Price,
// name, scope and the "MRD required" flag are re-resolved server-side from
// dbo.telo_custom_test; the client's numbers are never trusted.
const customItemSchema = z.object({
  id: z.coerce.number().int().positive(),
  qty: z.coerce.number().int().min(1).max(99),
});

// Empty form values arrive as '' — coerce those to undefined BEFORE numeric
// parsing, otherwise z.coerce.number('') === 0 and a 0 ref_doctor/ref_customer
// violates the FK to tbl_med_mcc_doctors/customer.
const optInt = (max?: number) =>
  z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    (() => {
      let s = z.coerce.number().int().min(0);
      if (max != null) s = s.max(max);
      return s.optional();
    })(),
  );
const zeroInt = z.preprocess(
  (v) => (v === '' || v == null ? 0 : v),
  z.coerce.number().int().min(0),
);

const sidSchema = z.object({
  sampleTypeId: z.coerce.number().int(),
  // SIDs are numeric-only barcodes — no letters or symbols.
  vailid: z.string().trim().min(1).max(50).regex(/^\d+$/, 'Sample ID must contain digits only'),
});

// CreatableValue serialization for Ref. doctor / Ref. customer. Either picks
// an existing master row by id or contributes a fresh name that the SP
// inserts inside the order transaction (deterministic TELO-{id} stamp).
const refValueSchema = z
  .union([
    z.object({ kind: z.literal('existing'), id: z.coerce.number().int().positive() }),
    z.object({ kind: z.literal('new'), name: z.string().trim().min(1).max(200) }),
  ])
  .nullable();

const registerSchema = z.object({
  mcc: z.coerce.number().int().positive(),
  sidsJson: z.string(),
  title: z.string().trim().max(10).optional(),
  name: z.string().trim().min(1).max(200),
  age: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.number().int().min(0).max(150),
  ),
  ageType: optInt(), // 1 Years / 2 Months / 3 Days
  gender: optInt(), // 1 Male / 2 Female / 3 Other
  // Optional at the schema layer; the per-channel rule (mandatory on B2C,
  // optional on B2B) is enforced after parse, once `b2b` is known.
  mobile: z.string().trim().max(20).optional().default(''),
  email: z.string().trim().max(100).optional(),
  clinicalHistory: z.string().trim().max(500).optional(),
  refDoctorJson: z.string().optional(),
  refCustomerJson: z.string().optional(),
  discountAmount: zeroInt,
  // Split payments: JSON array of { method, amount, ref } lines collected now
  // (e.g. ₹500 Cash + ₹500 UPI). Parsed/validated separately below.
  paymentsJson: z.string().optional(),
  // B2C Gold Card: '1' when applied. Halves the whole bill (50% off) and is
  // mutually exclusive with the manual discount. Ignored in B2B.
  goldCard: z.string().optional(),
  goldCardNumber: z.string().trim().max(50).optional(),
  goldCardHolder: z.string().trim().max(200).optional(),
  itemsJson: z.string(),
  // Telo-only custom lines: JSON array of { id, qty }. Optional; validated and
  // re-priced server-side below.
  customItemsJson: z.string().optional(),
  // '1' for a B2B-tab registration (bill at MRP); absent/empty for New Order.
  b2b: z.string().optional(),
  // B2B passport / travel ID → patient_master.MRNID. Optional; blank falls
  // back to the SP's patient-id backfill (same as the LIS form).
  mrnId: z.string().trim().max(50).optional(),
});

// One payment line from the form. `ref` is the operator-entered reference for
// a non-cash line (UPI ref, cheque no., card auth code); ≤50 to fit the
// receipt's card_number column (the SP also LEFT()s defensively). Method must
// be one of the offline PAY_METHODS.
const paymentLineSchema = z.object({
  method: z.enum(PAY_METHODS as unknown as [PayMethod, ...PayMethod[]]),
  amount: z.coerce.number().int().min(0),
  ref: z.string().trim().max(50).optional().default(''),
});

function parseRefValue(raw: string | undefined): z.infer<typeof refValueSchema> {
  if (!raw) return null;
  try {
    const parsed = refValueSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const MAX_CLINICAL_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Reads the optional clinical-history PDF from the form. Returns null when no
 * file was attached. Throws AppError on a bad upload (wrong type / too large)
 * — PDF is verified by both declared MIME and the `%PDF-` magic header.
 */
async function readClinicalPdf(
  formData: FormData,
): Promise<{ buffer: Buffer; name: string } | null> {
  const entry = formData.get('clinicalFile');
  if (!(entry instanceof File) || entry.size === 0) return null;
  if (entry.size > MAX_CLINICAL_PDF_BYTES) {
    throw new AppError('VALIDATION', 'Clinical history PDF must be 10 MB or smaller.');
  }
  const buffer = Buffer.from(await entry.arrayBuffer());
  const isPdf =
    buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  if (entry.type !== 'application/pdf' || !isPdf) {
    throw new AppError('VALIDATION', 'Clinical history attachment must be a PDF file.');
  }
  const name = (entry.name || 'clinical-history.pdf').slice(0, 100);
  return { buffer, name };
}

export type RegisterState = { error: string | null };

export async function registerOrder(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  let createdBillId: number | null = null;
  let isB2b = false;
  try {
    const parsed = registerSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: 'Please check the form — required fields are missing.' };
    }
    const f = parsed.data;

    let items: z.infer<typeof itemSchema>[];
    try {
      items = z.array(itemSchema).parse(JSON.parse(f.itemsJson));
    } catch {
      return { error: 'Add at least one test or profile.' };
    }

    // Telo-only custom lines (e.g. "Glucose - External"). Re-resolved &
    // re-priced server-side further below. An order may be custom-only.
    let customItemsRaw: z.infer<typeof customItemSchema>[];
    try {
      customItemsRaw = z
        .array(customItemSchema)
        .parse(JSON.parse(f.customItemsJson || '[]'));
    } catch {
      return { error: 'External test details are invalid.' };
    }
    if (items.length === 0 && customItemsRaw.length === 0) {
      return { error: 'Add at least one test or profile.' };
    }

    // SIDs are OPTIONAL at registration — an empty array is valid; the lab
    // technician accessions them later. Only entered SIDs are validated.
    let sampleSids: z.infer<typeof sidSchema>[];
    try {
      sampleSids = z.array(sidSchema).parse(JSON.parse(f.sidsJson));
    } catch {
      return { error: 'One of the Sample IDs is invalid.' };
    }
    // Defence in depth: reject duplicate vailids within the submission. The
    // SP enforces this too, but failing fast here gives a cleaner message.
    const seenVailids = new Set<string>();
    for (const s of sampleSids) {
      const v = s.vailid.trim();
      if (seenVailids.has(v)) {
        return { error: `Duplicate Sample ID "${v}" — each sample type needs its own.` };
      }
      seenVailids.add(v);
    }

    const user = await currentUser();
    if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in required');
    await requireCapabilityForMcc('order:create', f.mcc);

    // Re-resolve every custom line from the DB, scoped to THIS client code —
    // price, name, code, qty-allowed and the MRD-required flag all come from
    // dbo.telo_custom_test, never the client. An id that isn't an active custom
    // test for this client is rejected (out-of-scope / tampered POST).
    const customLines: {
      customTestId: number;
      code: string;
      name: string;
      unitAmount: number;
      qty: number;
      requiresMrd: boolean;
    }[] = [];
    let customTotal = 0;
    if (customItemsRaw.length > 0) {
      const clientCode = await clientCodeForMcc(f.mcc);
      if (!clientCode) {
        return { error: 'This collection centre cannot bill external tests.' };
      }
      for (const ci of customItemsRaw) {
        const def = await loadCustomTestForClient(ci.id, clientCode);
        if (!def) {
          return {
            error: 'An external test in this order is not available for this client.',
          };
        }
        const qty = def.allowQty ? Math.min(99, Math.max(1, ci.qty)) : 1;
        customLines.push({
          customTestId: def.id,
          code: def.code,
          name: def.name,
          unitAmount: def.mrp,
          qty,
          requiresMrd: def.requiresMrd,
        });
        customTotal += def.mrp * qty;
      }
    }
    const requiresMrd = customLines.some((c) => c.requiresMrd);

    // Per-mobile patient cap. The form pre-checks this live, but a tampered
    // POST (or a stale form) must not slip past — the SP repeats this count
    // inside the write as the final word. Skipped for a blank (B2B-optional)
    // mobile: counting `mobile_number = ''` would tally every number-less
    // patient in the network and block the order outright.
    if (f.mobile) {
      const mobileUses = await countMobileUsage(f.mobile);
      if (mobileUses >= MAX_PATIENTS_PER_MOBILE) {
        return {
          error: `This mobile number is already used by ${mobileUses} patients — the limit is ${MAX_PATIENTS_PER_MOBILE} patients per number.`,
        };
      }
    }

    const b2b = f.b2b === '1';
    isB2b = b2b;
    // MRP-only accounts (e.g. MDCARE) must never reach the B2B path, even via a
    // hand-crafted POST.
    if (b2b && (await fetchMrpOnly(user.uid))) {
      return { error: 'The B2B Orders feature is not available for this account.' };
    }

    // Per-channel mobile rule: mandatory on B2C, optional on B2B — but a
    // PARTIAL number is invalid on both channels. (The schema only bounds the
    // length; this is the actual requirement, mirrored in the form's gate.)
    if (!b2b && f.mobile.length < 10) {
      return { error: 'A mobile number of at least 10 digits is required.' };
    }
    if (f.mobile && f.mobile.length < 10) {
      return { error: 'Enter a complete mobile number (at least 10 digits), or leave it blank.' };
    }

    // Parse the split-payment lines. Drop zero-amount rows (an empty line the
    // operator never filled). Each surviving line is a receipt to be written.
    let payments: z.infer<typeof paymentLineSchema>[];
    try {
      payments = z
        .array(paymentLineSchema)
        .parse(JSON.parse(f.paymentsJson || '[]'))
        .filter((p) => p.amount > 0);
    } catch {
      return { error: 'Payment details are invalid — check the amounts.' };
    }
    const paidTotal = payments.reduce((s, p) => s + p.amount, 0);

    // Gold Card (B2C only): halves the whole bill and is mutually exclusive
    // with the manual discount. Card number + holder are mandatory when on.
    const gold = !b2b && f.goldCard === '1';
    if (gold && !isValidGoldCardNumber(f.goldCardNumber)) {
      return { error: 'Enter a valid Gold Card number (at least 4 characters).' };
    }
    if (gold && !isValidGoldCardHolder(f.goldCardHolder)) {
      return { error: 'Enter the Gold Card holder’s full name.' };
    }
    const discountAmount = gold ? 0 : f.discountAmount;

    // Server-authoritative 50% floor. Mirrors the client gate so a tampered
    // form can't post receipts summing below half the resolved total. B2B bills
    // at MRP, so the floor is computed against the MRP total in that mode. A
    // Gold Card halves each line (round half up) — matching the SP exactly.
    const rateList = b2b
      ? Array.from((await mrpMapFor(items)).values()).map((m) => m ?? 0)
      : (await resolveRatesBatch(f.mcc, items.map(toResolveItem))).map(
          (r) => r.rate ?? 0,
        );
    // Custom lines bill at their fixed amount (never gold-halved) and add to the
    // authoritative total the 50% floor / 20% discount cap are measured against.
    const resolvedTotal =
      rateList.reduce((s, r) => s + (gold ? Math.round(r / 2) : r), 0) +
      customTotal;
    const minPaid = resolvedTotal > 0 ? Math.round(resolvedTotal / 2) : 0;
    if (paidTotal < minPaid) {
      return {
        error: `At least ₹${minPaid} (50% of ₹${resolvedTotal}) must be collected now.`,
      };
    }
    // Discount ceiling is per-client (default 20%; MDCARE / MEDICARE locked to
    // 10%). Authoritative gate — mirrors the client cap so a tampered form can't
    // post a discount above the client's contractual limit. For MDCARE/MEDICARE
    // a set of floor-priced tests is non-discountable: their line value is
    // removed from the base, so the cap is a % of the OTHER lines only (custom
    // lines stay discountable). rateList is parallel to items; gold-halve to
    // match resolvedTotal (moot when gold, which forces discount to 0).
    const orderClientCode = await clientCodeForMcc(f.mcc);
    const discountLines = items.map((it, i) => ({
      code: it.code,
      amount: gold ? Math.round((rateList[i] ?? 0) / 2) : rateList[i] ?? 0,
    }));
    const discountBase = discountableTotal(orderClientCode, discountLines, resolvedTotal);
    const maxDiscount =
      discountBase > 0
        ? Math.round(discountBase * discountCapPct(orderClientCode))
        : 0;
    if (!gold && Number(discountAmount ?? 0) > maxDiscount) {
      const excluded = discountBase < resolvedTotal;
      return {
        error:
          maxDiscount === 0 && excluded
            ? 'No discount is allowed — these tests are billed at fixed rates for this client.'
            : `Discount cannot exceed ₹${maxDiscount} (${discountCapLabel(
                orderClientCode,
              )}% of the discountable ₹${discountBase}).`,
      };
    }

    // Every UPI line must carry a transaction reference (mirrors the client
    // gate) so every UPI receipt is traceable.
    if (payments.some((p) => p.method === 'UPI' && !p.ref.trim())) {
      return {
        error: 'Enter the UPI transaction ID / reference for each UPI payment.',
      };
    }

    const refDoc = parseRefValue(f.refDoctorJson);
    const refCust = parseRefValue(f.refCustomerJson);
    // Ref. doctor is compulsory for B2C New Orders (authoritative gate; the form
    // also blocks submit). Optional in B2B. parseRefValue already returns null
    // for an empty / malformed value or a 'new' entry with a blank name.
    if (!b2b && !refDoc) {
      return { error: 'Select or add a referring doctor.' };
    }
    // MRD is compulsory when the order carries a custom line that requires it
    // (e.g. "Glucose - External"). Captured via ref_customer (B2C free-text or
    // B2B referring-customer combobox). Authoritative gate; the SP repeats it.
    if (requiresMrd && !refCust) {
      return {
        error: b2b
          ? 'Select or add a referring customer — required for this external test.'
          : 'Enter the patient’s MRD number — it is required for this external test.',
      };
    }
    // MRD text snapshot for the custom-line log. B2C types it as a new
    // ref_customer name; B2B may pick an existing customer (use the typed
    // 'new' name when present, otherwise leave null — the FK id is enough).
    const mrdText = refCust?.kind === 'new' ? refCust.name : null;
    const clinicalPdf = await readClinicalPdf(formData);

    // Match the LIS order form exactly: it keeps the salutation in
    // patient_master.initial (separate from `name`, which stays bare — verified
    // against 12,691/12,694 normal authorized records) and never leaves
    // `initial` blank. Telo previously folded the salutation into `name` and
    // left `initial` NULL, which crashed the LIS report-download path. Pass the
    // chosen title (or a gender-derived default) as `initial` and keep `name`
    // clean. The SP applies the same `initial` fallback as a guard.
    // 'Other' is the operator's explicit "no salutation" choice: pass an EMPTY
    // (but non-NULL) initial so nothing prints before the name. The SP stores an
    // explicit empty string verbatim and only applies the gender-derived
    // fallback when initial is NULL (a truly-missing value), so the LIS report
    // path — which dereferences a non-NULL initial — stays safe. Any real title
    // is passed through; a blank/absent one still gets the Mr/Ms default.
    const genderInitial = f.gender === 2 ? 'Ms' : 'Mr';
    const initial =
      f.title === 'Other' ? '' : (f.title && f.title.trim()) || genderInitial;

    const result = await createOrder({
      userId: user.uid,
      mcc: f.mcc,
      sampleSids,
      patientId: 0,
      name: f.name,
      initial,
      age: f.age,
      gender: f.gender ?? null,
      ageType: f.ageType ?? null,
      mobile: f.mobile,
      email: f.email || null,
      clinicalHistory: f.clinicalHistory || null,
      clinicalFile: clinicalPdf?.buffer ?? null,
      clinicalFileName: clinicalPdf?.name ?? null,
      // Passport → MRNID (offered on both channels); blank lets the SP backfill
      // the patient id (LIS parity) — which the report header treats as "no
      // passport" and omits. See lib/report/assembleReportData.ts.
      mrnId: f.mrnId?.trim() || null,
      // Existing id wins; otherwise pass the fresh name and the SP upserts.
      refDoctor: refDoc?.kind === 'existing' ? refDoc.id : null,
      refCustomer: refCust?.kind === 'existing' ? refCust.id : null,
      newRefDoctorName: refDoc?.kind === 'new' ? refDoc.name : null,
      newRefCustomerName: refCust?.kind === 'new' ? refCust.name : null,
      items: items.map((i) => ({
        id: i.id,
        kind: i.kind,
        code: i.code,
        name: i.name,
      })),
      customLines,
      mrdText,
      discountAmount,
      payMode: 1, // LIS standard paymode; real method captured per receipt line
      // One receipt per line; ref only meaningful for non-cash (ignored for Cash).
      payments: payments.map((p) => ({
        method: p.method,
        amount: p.amount,
        ref: p.method !== 'Cash' ? p.ref.trim() || null : null,
      })),
      billAtMrp: b2b,
      // Gold Card halves the bill (B2C only); the SP records the card.
      goldCard: gold,
      goldCardNumber: gold ? f.goldCardNumber!.trim() : null,
      goldCardHolder: gold ? f.goldCardHolder!.trim() : null,
    });

    if (!result.ok || result.billId == null) {
      const msg =
        result.errorCode === 'CONFLICT'
          ? result.message || 'Duplicate sample ID — use a unique SID.'
          : result.message || 'Order could not be placed.';
      return { error: msg };
    }

    audit({
      kind: 'order.placed',
      uid: user.uid,
      mcc: f.mcc,
      billId: result.billId,
      total: result.total,
    });
    // If the order minted a new referrer, bust this MCC's ref cache so the
    // next form open shows the fresh entry immediately.
    if (refDoc?.kind === 'new' || refCust?.kind === 'new') {
      await invalidateRefDataCache(f.mcc);
    }
    // Clear the catalog cart — items were consumed by this order.
    await clearCart(user.uid);
    // Carry the new bill id back to the worklist so the receptionist can print
    // its bill/lab receipt immediately.
    createdBillId = result.billId;
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof AppError) return { error: e.message };
    return { error: 'Something went wrong placing the order.' };
  }

  // Back to the originating worklist (New vs B2B) — the lab tech accessions any
  // missing SIDs there, and the receptionist can print the bill immediately.
  const worklist = isB2b ? '/orders/b2b' : '/orders/new';
  redirect(createdBillId != null ? `${worklist}?created=${createdBillId}` : worklist);
}
