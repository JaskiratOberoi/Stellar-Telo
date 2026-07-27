'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { currentUser } from '@/auth/session';
import { getMccScope } from '@/auth/scope';
import { requireCapabilityForMcc } from '@/auth/guards';
import {
  getOrder,
  fetchPatientTestItems,
  listPendingRegistrations,
  type OrderDetail,
} from '@/db/read/orders';
import { previewSampleGroups, type SampleGroup } from '@/db/sp/previewSampleGroups';
import { addSids } from '@/db/sp/addSids';
import { accessionSamples } from '@/db/sp/accessionSamples';
import { hasCapability } from '@/auth/rbac';
import { audit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';

/** A required sample group + the SID already accessioned for it (if any). */
export interface AccessionGroup extends SampleGroup {
  existingSid: string | null;
}

export interface AccessionView {
  order: OrderDetail;
  groups: AccessionGroup[];
  /** true once every group has a SID — nothing left to accession. */
  complete: boolean;
}

/**
 * Loads an order for the accession page: read-only patient/tests/samples plus
 * the required sample groups, each marked with the SID already assigned (or
 * null if still missing).
 */
export async function getAccessionView(
  billId: number,
): Promise<AccessionView | null> {
  const user = await currentUser();
  if (!user) return null;
  const scope = await getMccScope(user.uid);
  const order = await getOrder(billId, scope);
  if (!order || order.patientId == null) return null;

  const items = await fetchPatientTestItems(order.patientId);
  const groups = await previewSampleGroups(items);

  const accessionGroups: AccessionGroup[] = groups.map((g) => {
    const existing = order.samples.find(
      (s) => (s.sampleTypeId ?? -1) === g.sampleTypeId,
    );
    return { ...g, existingSid: existing?.vailid ?? null };
  });

  return {
    order,
    groups: accessionGroups,
    complete: accessionGroups.every((g) => g.existingSid != null),
  };
}

const sidSchema = z.object({
  sampleTypeId: z.coerce.number().int(),
  vailid: z.string().trim().min(1).max(50),
});

export type AccessionState = { error: string | null };

/**
 * Persists newly-entered Sample IDs onto an already-registered order, then
 * returns the user to the worklist. Patient details / tests are never edited.
 */
export async function submitSids(
  _prev: AccessionState,
  formData: FormData,
): Promise<AccessionState> {
  try {
    const billId = Number(formData.get('billId'));
    if (!Number.isInteger(billId)) return { error: 'Invalid order.' };

    let sampleSids: z.infer<typeof sidSchema>[];
    try {
      sampleSids = z
        .array(sidSchema)
        .min(1)
        .parse(JSON.parse(String(formData.get('sidsJson') ?? '[]')));
    } catch {
      return { error: 'Enter at least one Sample ID.' };
    }
    const seen = new Set<string>();
    for (const s of sampleSids) {
      const v = s.vailid.trim();
      if (seen.has(v)) {
        return { error: `Duplicate Sample ID "${v}" — each sample type needs its own.` };
      }
      seen.add(v);
    }

    const user = await currentUser();
    if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in required');
    const scope = await getMccScope(user.uid);
    const order = await getOrder(billId, scope);
    if (!order || order.patientId == null || order.mccCode == null) {
      return { error: 'Order not found in your collection centres.' };
    }
    await requireCapabilityForMcc('order:accession', order.mccCode);

    const result = await addSids({
      userId: user.uid,
      patientId: order.patientId,
      mcc: order.mccCode,
      sampleSids,
    });

    if (!result.ok) {
      return { error: result.message || 'Could not save the Sample IDs.' };
    }
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof AppError) return { error: e.message };
    return { error: 'Something went wrong saving the Sample IDs.' };
  }

  redirect('/orders/new');
}

export interface RegisterSamplesResult {
  ok: boolean;
  error: string | null;
  registered: number;
  skipped: number;
  /** Tests billed to the client account, and the total ₹ deducted. */
  charged: number;
  chargeTotal: number;
}

/**
 * Telo-side "Register" — the LIS Accession screen's action, for the samples
 * listed in the Pending accessioning table.
 *
 * Writes the empty result skeleton and moves each sample to 'Sample Registered'
 * so it reaches the worksheet. See db/sql/68_usp_telo_accession_samples.sql.
 *
 * Scope is fail-closed: the submitted SIDs are intersected with the pending set
 * the caller can actually see (listPendingRegistrations is scope-filtered), so
 * a hand-crafted request cannot register another centre's samples. Capability
 * is re-checked per MCC, mirroring submitSids.
 */
export async function registerSamplesAction(
  vailids: string[],
  kind: 'new' | 'b2b' = 'b2b',
): Promise<RegisterSamplesResult> {
  try {
    const user = await currentUser();
    if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in required');
    if (!hasCapability(user.caps, 'order:accession')) {
      return { ok: false, error: 'You cannot accession samples.', registered: 0, skipped: 0, charged: 0, chargeTotal: 0 };
    }
    const wanted = Array.from(
      new Set((vailids ?? []).map((v) => (v ?? '').toString().trim()).filter(Boolean)),
    ).slice(0, 200);
    if (wanted.length === 0) {
      return { ok: false, error: 'Select at least one sample.', registered: 0, skipped: 0, charged: 0, chargeTotal: 0 };
    }

    // Only SIDs the caller can currently see as pending are eligible.
    const scope = await getMccScope(user.uid);
    const pending = await listPendingRegistrations(scope, kind);
    const allowed = new Set(pending.map((p) => p.vailid));
    const target = wanted.filter((v) => allowed.has(v));
    if (target.length === 0) {
      return {
        ok: false,
        error: 'None of those samples are pending accessioning in your centres.',
        registered: 0,
        skipped: 0,
        charged: 0,
        chargeTotal: 0,
      };
    }
    // Re-check the capability against each sample's own MCC.
    for (const mcc of new Set(
      pending.filter((p) => target.includes(p.vailid)).map((p) => p.mccId),
    )) {
      if (mcc != null) await requireCapabilityForMcc('order:accession', mcc);
    }

    const res = await accessionSamples({
      userId: user.uid,
      username: user.username,
      vailids: target,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: res.message || 'Could not register the samples.',
        registered: 0,
        skipped: 0,
        charged: 0,
        chargeTotal: 0,
      };
    }
    audit({
      kind: 'sample.accessioned',
      actor: user.uid,
      registered: res.registered,
      skipped: res.skipped,
      charged: res.charged,
      chargeTotal: res.chargeTotal,
    });
    revalidatePath(kind === 'b2b' ? '/orders/b2b' : '/orders/new');
    return {
      ok: true,
      error: null,
      registered: res.registered,
      skipped: res.skipped,
      charged: res.charged,
      chargeTotal: res.chargeTotal,
    };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, registered: 0, skipped: 0, charged: 0, chargeTotal: 0 };
    return {
      ok: false,
      error: 'Something went wrong registering the samples.',
      registered: 0,
      skipped: 0,
      charged: 0,
      chargeTotal: 0,
    };
  }
}
