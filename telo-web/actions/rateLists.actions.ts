'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { requireCapability } from '@/auth/guards';
import { setRate, createRateList } from '@/db/sp/rateAdmin';
import { AppError } from '@/lib/errors';

export type SetRateState = { ok: boolean; error: string | null };

/** Inline per-test price edit. Requires rate:manage. */
export async function saveRate(
  rateTypeId: number,
  testMasterId: number,
  price: number,
): Promise<SetRateState> {
  try {
    await requireCapability('rate:manage');
    if (!Number.isInteger(price) || price < 0) {
      return { ok: false, error: 'Enter a valid non-negative price.' };
    }
    const r = await setRate(rateTypeId, testMasterId, price);
    if (!r.ok) return { ok: false, error: r.message ?? 'Could not save rate.' };
    revalidatePath(`/rate-lists/${rateTypeId}`);
    return { ok: true, error: null };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    return { ok: false, error: 'Something went wrong saving the rate.' };
  }
}

const createSchema = z.object({ name: z.string().trim().min(1).max(50) });
export type CreateRateListState = { error: string | null };

/** Create a new rate list seeded from the default 'rate' list. */
export async function createRateListAction(
  _prev: CreateRateListState,
  formData: FormData,
): Promise<CreateRateListState> {
  let newId: number;
  try {
    const user = await requireCapability('rate:manage');
    const parsed = createSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: 'Enter a rate list name (1–50 characters).' };
    }
    const r = await createRateList(parsed.data.name, user.uid);
    if (!r.ok || r.rateTypeId == null) {
      return { error: r.message ?? 'Could not create the rate list.' };
    }
    revalidatePath('/rate-lists');
    newId = r.rateTypeId;
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof AppError) return { error: e.message };
    return { error: 'Something went wrong creating the rate list.' };
  }
  redirect(`/rate-lists/${newId}`);
}
