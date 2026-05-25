import 'server-only';
import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { assertMccInScope } from '@/auth/scope';
import { AppError } from '@/lib/errors';
import type { Capability, TeloUser } from '@/types/auth';

/**
 * The real enforcement point — called at the top of every server action.
 * Combine with assertMccInScope() for any MCC-bound mutation.
 */
export async function requireCapability(cap: Capability): Promise<TeloUser> {
  const user = await currentUser();
  if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in required');
  if (!hasCapability(user.caps, cap)) {
    throw new AppError('FORBIDDEN', `Missing capability: ${cap}`);
  }
  return user;
}

/** Capability + MCC scope in one call for order/bill mutations. */
export async function requireCapabilityForMcc(
  cap: Capability,
  mccCode: number,
): Promise<TeloUser> {
  const user = await requireCapability(cap);
  await assertMccInScope(user.uid, mccCode);
  return user;
}
