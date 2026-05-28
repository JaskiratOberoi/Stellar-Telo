import 'server-only';
import { currentUser } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { assertMccInScope } from '@/auth/scope';
import { AppError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';
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

/**
 * Per-actor throttle for sensitive admin actions. Use to prevent runaway
 * automation (deliberate or accidental) from a Super Admin account
 * silently mass-resetting passwords or flipping IsActive on every user.
 *
 * Defaults are generous enough that a human admin clicking quickly through
 * the UI never hits the cap; an honest mistake (e.g. a stuck form submit)
 * gets a clean message rather than running unbounded. Throws AppError so
 * the wrapping try/catch in each action returns a user-visible message
 * (the same path used for missing-capability errors).
 */
export async function throttleAdminAction(
  actorUid: number,
  actionKind: string,
  opts: { limit?: number; windowSeconds?: number } = {},
): Promise<void> {
  const limit = opts.limit ?? 30;
  const windowSeconds = opts.windowSeconds ?? 60;
  const { allowed } = await rateLimit(
    `admin:${actionKind}:${actorUid}`,
    limit,
    windowSeconds,
  );
  if (!allowed) {
    throw new AppError(
      'RATE_LIMITED',
      'Too many admin actions in a short window — please slow down and try again in a minute.',
    );
  }
}
