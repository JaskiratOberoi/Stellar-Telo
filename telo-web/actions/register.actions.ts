'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { currentUser } from '@/auth/session';
import { requireCapability, requireCapabilityForMcc } from '@/auth/guards';
import { getMccScope } from '@/auth/scope';
import { loadCatalog, filterCatalog } from '@/db/read/catalog';
import {
  fetchDoctorsForMcc,
  fetchCustomersForMcc,
  invalidateRefDataCache,
  type RefEntity,
} from '@/db/read/refData';
import { sidExistsInScope } from '@/db/read/sid';
import { resolveRatesBatch } from '@/db/sp/resolveRate';
import { createOrder } from '@/db/sp/createOrder';
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
  kind: 'all' | 'test' | 'profile' = 'all',
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
 * Real-time SID duplicate check for the new-order form. Auth-gated, read-only,
 * and scoped to the caller's MCCs — without scoping any signed-in user could
 * enumerate sample IDs from centres they don't own. 'taken' is advisory — the
 * SP + trigger still enforce uniqueness on submit.
 */
export async function checkSid(
  sid: string,
): Promise<{ status: 'available' | 'taken' | 'empty' }> {
  let user;
  try {
    user = await requireCapability('order:create');
  } catch {
    return { status: 'empty' };
  }
  const v = (sid ?? '').trim();
  if (!v) return { status: 'empty' };
  const scope = await getMccScope(user.uid);
  return {
    status: (await sidExistsInScope(v, scope)) ? 'taken' : 'available',
  };
}

export interface PreviewLine {
  id: number;
  kind: 'test' | 'profile';
  code: string;
  name: string;
  rate: number | null;
  source: string;
}
export interface PreviewResult {
  lines: PreviewLine[];
  total: number;
}

/**
 * Live sample-type grouping for the New Order form. Returns one group per
 * distinct sample type the order needs; the form renders one SID input per
 * group, labeled by sample-type name and showing the codes in each bucket.
 */
export async function previewSampleGroupsAction(
  items: { id: number; kind: 'test' | 'profile'; code: string; name: string }[],
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
  items: { id: number; kind: 'test' | 'profile'; code: string; name: string }[],
): Promise<PreviewResult> {
  const user = await currentUser();
  if (!user) return { lines: [], total: 0 };
  if (items.length === 0) return { lines: [], total: 0 };

  const rates = await resolveRatesBatch(
    mcc != null && Number.isInteger(mcc) ? mcc : null,
    items.map((it) => ({
      testMasterId: it.kind === 'test' ? it.id : null,
      profileCode: it.kind === 'profile' ? it.id : null,
    })),
  );
  const lines: PreviewLine[] = items.map((it, idx) => {
    const rr = rates[idx];
    return { ...it, rate: rr.rate, source: rr.source };
  });
  const total = lines.reduce((s, l) => s + (l.rate ?? 0), 0);
  return { lines, total };
}

const itemSchema = z.object({
  id: z.coerce.number().int().positive(),
  kind: z.enum(['test', 'profile']),
  code: z.string(),
  name: z.string(),
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
  mobile: z.string().trim().min(10).max(20),
  email: z.string().trim().max(100).optional(),
  clinicalHistory: z.string().trim().max(500).optional(),
  refDoctorJson: z.string().optional(),
  refCustomerJson: z.string().optional(),
  discountAmount: zeroInt,
  paymentType: z.string().trim().max(50).optional(),
  receiptAmount: zeroInt,
  itemsJson: z.string(),
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
  try {
    const parsed = registerSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: 'Please check the form — required fields are missing.' };
    }
    const f = parsed.data;

    let items: z.infer<typeof itemSchema>[];
    try {
      items = z.array(itemSchema).min(1).parse(JSON.parse(f.itemsJson));
    } catch {
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

    const refDoc = parseRefValue(f.refDoctorJson);
    const refCust = parseRefValue(f.refCustomerJson);
    const clinicalPdf = await readClinicalPdf(formData);

    const result = await createOrder({
      userId: user.uid,
      mcc: f.mcc,
      sampleSids,
      patientId: 0,
      name: f.title ? `${f.title} ${f.name}` : f.name,
      age: f.age,
      gender: f.gender ?? null,
      ageType: f.ageType ?? null,
      mobile: f.mobile,
      email: f.email || null,
      clinicalHistory: f.clinicalHistory || null,
      clinicalFile: clinicalPdf?.buffer ?? null,
      clinicalFileName: clinicalPdf?.name ?? null,
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
      discountAmount: f.discountAmount,
      paymentType: f.paymentType || null,
      payMode: 1, // LIS standard paymode; method captured in paymentType text
      receiptAmount: f.receiptAmount,
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
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof AppError) return { error: e.message };
    return { error: 'Something went wrong placing the order.' };
  }

  // Back to the New Order worklist — the lab tech accessions any missing SIDs.
  redirect('/orders/new');
}
