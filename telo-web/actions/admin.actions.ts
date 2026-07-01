'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireCapability, throttleAdminAction } from '@/auth/guards';
import { invalidateMccScope } from '@/auth/scope';
import { bumpSessionVersion } from '@/db/read/sessionVersion';
import {
  listTeloUsers,
  fetchLisUsertypes,
  type TeloUserRow,
  type LisUsertype,
} from '@/db/read/teloUsers';
import {
  fetchMccUnitsByIds,
  searchMccUnits,
  type ScopedMcc,
} from '@/db/read/mccUnits';
import {
  listProfilesWithInterpretation,
  upsertProfileInterpretation,
  type ProfileInterpRow,
} from '@/db/read/profileInterpretations';
import {
  adminCreateUser,
  adminSetRole,
  adminResetPassword,
  adminSetActive,
  adminSetLisAccess,
  adminSetMrpOnly,
  adminSetPreparedBy,
} from '@/db/sp/adminUsers';
import { getPool, sql, withRetry } from '@/db/pool';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import type { TeloRole } from '@/types/auth';

export interface AdminOverview {
  users: TeloUserRow[];
  lisUsertypes: LisUsertype[];
  fetchedAt: string;
}

// MCC list is no longer shipped in the admin overview — the picker fetches
// matches on demand via searchMccUnitsAction (≤50 rows per call) instead.
// Saves ~1.7k rows × ~60 B of RSC payload on every admin page render.
export async function getAdminOverview(): Promise<AdminOverview> {
  await requireCapability('user:manage');
  const [users, lisUsertypes] = await Promise.all([
    listTeloUsers(),
    fetchLisUsertypes(),
  ]);
  return {
    users,
    lisUsertypes,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Picker search: ≤50 active MCCs matching the query, optionally hiding
 * already-chosen ids. Gated on `user:manage` since this is admin-only UI.
 */
export async function searchMccUnitsAction(
  query: string,
  excludeIds: number[] = [],
): Promise<ScopedMcc[]> {
  await requireCapability('user:manage');
  return searchMccUnits(query, { excludeIds, limit: 50 });
}

/** Resolve picked MCC ids to display rows (chip labels). */
export async function fetchMccUnitsByIdsAction(
  ids: number[],
): Promise<ScopedMcc[]> {
  await requireCapability('user:manage');
  return fetchMccUnitsByIds(ids);
}

/**
 * Write per-user MCC scope rows to `tbl_med_user_sales_mcc_mapping` — the
 * same table `fetchUserMccScope` reads from. Does NOT touch the SP; the
 * mapping rows are independent inserts so this is purely additive to the
 * shared LIS schema (no DDL, no constraints).
 *
 * `replace=true` clears any existing mapping first (rare admin override);
 * default mode just appends so we never accidentally drop LIS-side mappings
 * the actor isn't aware of.
 */
async function assignMccScope(
  userId: number,
  mccIds: number[],
  opts: { replace?: boolean } = {},
): Promise<void> {
  if (!Number.isInteger(userId)) return;
  const ids = mccIds.filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0 && !opts.replace) return;
  try {
    await withRetry(async () => {
      const pool = await getPool();
      if (opts.replace) {
        await pool
          .request()
          .input('uid', sql.Int, userId)
          .query(
            `DELETE FROM dbo.tbl_med_user_sales_mcc_mapping WHERE user_id = @uid`,
          );
      }
      // Row-by-row INSERT with NOT EXISTS — idempotent (re-saving the same
      // scope is a no-op) and small (≤ a few dozen rows per user). Admin
      // onboarding is rare + low-volume, so the per-row round-trip is fine.
      for (const mccId of ids) {
        await pool
          .request()
          .input('uid', sql.Int, userId)
          .input('mcc', sql.Int, mccId)
          .query(`
            IF NOT EXISTS (
              SELECT 1 FROM dbo.tbl_med_user_sales_mcc_mapping
              WHERE user_id = @uid AND mcc_code = @mcc
            )
            INSERT INTO dbo.tbl_med_user_sales_mcc_mapping (user_id, mcc_code)
            VALUES (@uid, @mcc);
          `);
      }
    });
  } finally {
    // Always bust the cache, even on partial failure — the DB state is now
    // ambiguous and we want the next read to hit the source of truth, not a
    // 5-minute-stale snapshot. Idempotent / safe even when no rows changed.
    await invalidateMccScope(userId);
  }
}

// Keep this in sync with the TeloRole union (types/auth.ts) AND the SP's
// allow-list (db/sql/98_usp_telo_admin_set_role.sql). The `_RolesInSync` guard
// below fails to compile if a TeloRole is added to the type but missed here —
// which is exactly the bug that made b2c_billing / b2b_billing / client_reporting
// unsavable ("Invalid role change") after they were added everywhere else.
const teloRoleSchema = z.enum([
  'super_admin',
  'admin',
  'billing',
  'b2c_billing',
  'b2b_billing',
  'client',
  'client_reporting',
  'technician',
  'viewer',
]);
// Compile-time exhaustiveness: every TeloRole must appear in the enum above.
type _RolesInSync =
  [TeloRole] extends [z.infer<typeof teloRoleSchema>] ? true : never;
const _rolesInSync: _RolesInSync = true;
void _rolesInSync;

export type AdminFormState = { error: string | null; ok: boolean };
const ok = (): AdminFormState => ({ error: null, ok: true });
const err = (m: string): AdminFormState => ({ error: m, ok: false });

// Password policy: ≥12 chars (admin-set passwords). Stronger than the
// historical 4-char minimum which was a pragmatic legacy compromise; with
// the rate-limited login + bumped session_version on rotation, weak admin
// passwords are now the most-likely path to account takeover.
const PASSWORD_MIN = 12;

const createSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().trim().min(PASSWORD_MIN).max(72),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).optional(),
  email: z.string().trim().max(100).optional(),
  lisUsertypeId: z.coerce.number().int().positive(),
  teloRole: teloRoleSchema,
  // CSV of MCC unit IDs to grant scope for, e.g. "12,45". Optional — Super
  // Admin / Admin roles bypass scoping anyway; Billing/Technician/Viewer
  // typically need at least one.
  mccIdsCsv: z.string().trim().max(2000).optional().default(''),
});

function parseMccIds(csv: string): number[] {
  if (!csv) return [];
  return Array.from(
    new Set(
      csv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  );
}

export async function createUserAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    const actor = await requireCapability('user:manage');
    await throttleAdminAction(actor.uid, 'create');
    const parsed = createSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const pw = parsed.error.flatten().fieldErrors.password;
      if (pw && pw.length > 0) {
        return err(
          `Password must be at least ${PASSWORD_MIN} characters.`,
        );
      }
      return err('Please fill all required fields.');
    }
    const f = parsed.data;
    const mccIds = parseMccIds(f.mccIdsCsv);

    const res = await adminCreateUser({
      username: f.username,
      password: f.password,
      firstName: f.firstName,
      lastName: f.lastName || null,
      email: f.email || null,
      lisUsertypeId: f.lisUsertypeId,
      teloRole: f.teloRole,
      actor: actor.uid,
    });
    if (!res.ok || res.userId == null) {
      return err(res.message || 'Could not create the user.');
    }

    // Best-effort scope grant — if this fails the user IS created, the
    // super admin just needs to re-assign scope from the row's Role panel.
    if (mccIds.length > 0) {
      try {
        await assignMccScope(res.userId, mccIds);
      } catch (e) {
        // Log audit but don't fail the whole onboarding. The user can sign
        // in; a Super Admin re-attempts the scope assignment.
        audit({
          kind: 'admin.user.scope.partial',
          actor: actor.uid,
          target: res.userId,
          mccCount: mccIds.length,
          error: e instanceof Error ? e.message.slice(0, 200) : String(e),
        });
      }
    }

    audit({
      kind: 'admin.user.create',
      actor: actor.uid,
      target: res.userId,
      role: f.teloRole,
      lisUsertypeId: f.lisUsertypeId,
      mccCount: mccIds.length,
    });
    revalidatePath('/admin/users');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong creating the user.');
  }
}

/**
 * Resolves the current MCC scope for a Telo-created user — returns
 * `tbl_med_user_sales_mcc_mapping` rows so the Edit panel can pre-populate
 * its chip list. Refuses non-Telo users (defence in depth — the row Edit
 * button is also hidden for them, but URL-typing the action shouldn't
 * leak LIS-side scope either).
 */
export async function getEditableUserScope(userId: number): Promise<{
  ok: boolean;
  mccIds: number[];
  error: string | null;
}> {
  await requireCapability('user:manage');
  if (!Number.isInteger(userId) || userId <= 0) {
    return { ok: false, mccIds: [], error: 'Invalid user.' };
  }
  return withRetry(async () => {
    const pool = await getPool();
    const guard = await pool
      .request()
      .input('uid', sql.Int, userId)
      .query<{ telo: number }>(
        `SELECT CASE WHEN createdby LIKE 'telo:%' THEN 1 ELSE 0 END AS telo
         FROM dbo.tbl_med_user_master WHERE id = @uid`,
      );
    if (guard.recordset[0]?.telo !== 1) {
      return {
        ok: false,
        mccIds: [],
        error: 'Only Telo-created users are editable from this panel.',
      };
    }
    const r = await pool
      .request()
      .input('uid', sql.Int, userId)
      .query<{ mcc_code: number }>(
        `SELECT DISTINCT mcc_code FROM dbo.tbl_med_user_sales_mcc_mapping
         WHERE user_id = @uid AND mcc_code IS NOT NULL`,
      );
    return {
      ok: true,
      mccIds: r.recordset.map((x) => x.mcc_code),
      error: null,
    };
  });
}

const updateUserSchema = z.object({
  userId: z.coerce.number().int().positive(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).optional(),
  email: z.string().trim().max(100).optional(),
  mccIdsCsv: z.string().trim().max(2000).optional().default(''),
});

/**
 * Edit a Telo-created user. Updates the editable profile fields
 * (first/last name, email) on `tbl_med_user_master` and *replaces* the MCC
 * scope mappings. Refuses LIS-created users — the row Edit button is also
 * hidden for them, this is defence in depth against URL-typed action
 * submissions.
 */
export async function updateUserAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    const actor = await requireCapability('user:manage');
    await throttleAdminAction(actor.uid, 'update');
    const parsed = updateUserSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Please fill all required fields.');
    const f = parsed.data;

    // Guard: only Telo-created users editable here.
    const ok2 = await withRetry(async () => {
      const pool = await getPool();
      const r = await pool
        .request()
        .input('uid', sql.Int, f.userId)
        .query<{ telo: number }>(
          `SELECT CASE WHEN createdby LIKE 'telo:%' THEN 1 ELSE 0 END AS telo
           FROM dbo.tbl_med_user_master WHERE id = @uid`,
        );
      return r.recordset[0]?.telo === 1;
    });
    if (!ok2) {
      return err(
        'This user was not created via Telo — edits must be made on the LIS side.',
      );
    }

    // Update profile fields directly (no SP — these are non-critical and
    // the LIS already mutates them via its own UI).
    await withRetry(async () => {
      const pool = await getPool();
      await pool
        .request()
        .input('uid', sql.Int, f.userId)
        .input('fn', sql.NVarChar(100), f.firstName)
        .input('ln', sql.NVarChar(100), f.lastName ?? '')
        .input('em', sql.NVarChar(100), f.email ?? '')
        .input('actor', sql.Int, actor.uid)
        .query(`
          UPDATE dbo.tbl_med_user_master
          SET firstname  = @fn,
              lastname   = @ln,
              Email      = @em,
              updatedby  = CONCAT(N'telo:', @actor),
              updateddate = GETDATE()
          WHERE id = @uid
        `);
    });

    // Replace the MCC scope mappings — full overwrite so that removing a
    // chip in the UI actually drops the row.
    const mccIds = parseMccIds(f.mccIdsCsv);
    await assignMccScope(f.userId, mccIds, { replace: true });

    // NOTE: the "Prepared By" override is NOT set here. It lives in its own
    // action (setPreparedByAction) because — unlike name/email/scope — it only
    // touches the Telo-owned sidecar and so is safe for native LIS accounts
    // (which this Telo-only path rejects). See that action's doc comment.

    audit({
      kind: 'admin.user.update',
      actor: actor.uid,
      target: f.userId,
      mccCount: mccIds.length,
    });
    revalidatePath('/admin/users');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong updating the user.');
  }
}

const preparedBySchema = z.object({
  userId: z.coerce.number().int().positive(),
  preparedBy: z.string().trim().max(120).optional().default(''),
});

/**
 * Set (or clear) the per-account "Prepared By" override for ANY Telo-managed
 * account — i.e. any user that has a `dbo.telo_account` row, whether it was
 * Telo-created OR a native LIS account Telo later attached a sidecar row to.
 *
 * Deliberately NOT gated on `createdByTelo` (unlike the profile/scope Edit):
 * the override writes only the Telo-owned `telo_account.prepared_by` sidecar
 * column, never an LIS-managed field, so it's safe for native accounts. The
 * SP (`usp_telo_admin_set_prepared_by`) rejects users with no telo_account
 * row, so a non-managed LIS user can't be targeted. Empty value clears it.
 */
export async function setPreparedByAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    const actor = await requireCapability('user:manage');
    await throttleAdminAction(actor.uid, 'prepared_by');
    const parsed = preparedBySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Invalid request.');
    const { userId, preparedBy } = parsed.data;

    const res = await adminSetPreparedBy({
      userId,
      preparedBy: preparedBy ?? '',
      actor: actor.uid,
    });
    if (!res.ok) {
      return err(res.message || 'Could not update the Prepared-by override.');
    }

    audit({
      kind: 'admin.user.prepared_by',
      actor: actor.uid,
      target: userId,
      cleared: (preparedBy ?? '').trim().length === 0,
    });
    revalidatePath('/admin/users');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong updating the Prepared-by override.');
  }
}

const setRoleSchema = z.object({
  userId: z.coerce.number().int().positive(),
  teloRole: teloRoleSchema,
});

export async function setRoleAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    const actor = await requireCapability('user:manage');
    await throttleAdminAction(actor.uid, 'role');
    const parsed = setRoleSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Invalid role change.');
    const { userId, teloRole } = parsed.data;

    const res = await adminSetRole({ userId, teloRole, actor: actor.uid });
    if (!res.ok) return err(res.message || 'Could not update the role.');

    // Bump the session version so any outstanding JWT this user holds is
    // treated as revoked by the next auth() call (within ~30s, the Redis
    // TTL on the cached version). Also bust scope cache to be safe.
    await Promise.all([
      bumpSessionVersion(userId, actor.uid),
      invalidateMccScope(userId),
    ]);

    audit({
      kind: 'admin.user.role',
      actor: actor.uid,
      target: userId,
      role: teloRole,
    });
    revalidatePath('/admin/users');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong updating the role.');
  }
}

const resetSchema = z.object({
  userId: z.coerce.number().int().positive(),
  newPassword: z.string().trim().min(PASSWORD_MIN).max(72),
});

export async function resetPasswordAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    const actor = await requireCapability('user:manage');
    // Tighter window than other admin actions: bulk password resets are a
    // high-impact destructive pattern, so cap at 10/min/actor.
    await throttleAdminAction(actor.uid, 'password', { limit: 10 });
    const parsed = resetSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return err(`Enter a password of at least ${PASSWORD_MIN} characters.`);
    }
    const { userId, newPassword } = parsed.data;

    const res = await adminResetPassword({
      userId,
      newPassword,
      actor: actor.uid,
    });
    if (!res.ok) return err(res.message || 'Could not reset the password.');

    // Bump session version — a password reset implies the old credential
    // may be compromised, so any session still using the old token should
    // be forced through /login.
    await bumpSessionVersion(userId, actor.uid);

    // NEVER log the password value.
    audit({ kind: 'admin.user.password', actor: actor.uid, target: userId });
    revalidatePath('/admin/users');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong resetting the password.');
  }
}

const activeSchema = z.object({
  userId: z.coerce.number().int().positive(),
  active: z.preprocess((v) => v === 'true' || v === true, z.boolean()),
});

export async function setActiveAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    const actor = await requireCapability('user:manage');
    await throttleAdminAction(actor.uid, 'active');
    const parsed = activeSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Invalid request.');
    const { userId, active } = parsed.data;

    const res = await adminSetActive({ userId, active, actor: actor.uid });
    if (!res.ok) return err(res.message || 'Could not update the user.');

    // Deactivation MUST revoke any outstanding JWT — bump the session
    // version so the user is forced back through /login on their next
    // request (Redis cache TTL is 30s, so this is near-immediate).
    // Re-activation also bumps so the user can re-enter with fresh caps.
    // Scope cache is busted in parallel for the same near-immediate effect.
    await Promise.all([
      bumpSessionVersion(userId, actor.uid),
      invalidateMccScope(userId),
    ]);

    audit({
      kind: 'admin.user.active',
      actor: actor.uid,
      target: userId,
      active,
    });
    revalidatePath('/admin/users');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong updating the user.');
  }
}

const lisAccessSchema = z.object({
  userId: z.coerce.number().int().positive(),
  enabled: z.preprocess((v) => v === 'true' || v === true, z.boolean()),
});

/**
 * Enable/disable LIS login for a Telo-created account. This flips the LIS
 * IsActive gate (via telo_account.lis_access) WITHOUT touching the user's Telo
 * login — so no session-version bump is needed (the Telo JWT stays valid).
 */
export async function setLisAccessAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    const actor = await requireCapability('user:manage');
    await throttleAdminAction(actor.uid, 'lis');
    const parsed = lisAccessSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Invalid request.');
    const { userId, enabled } = parsed.data;

    const res = await adminSetLisAccess({ userId, enabled, actor: actor.uid });
    if (!res.ok) return err(res.message || 'Could not update LIS access.');

    audit({
      kind: 'admin.user.lis_access',
      actor: actor.uid,
      target: userId,
      enabled,
    });
    revalidatePath('/admin/users');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong updating LIS access.');
  }
}

const mrpOnlySchema = z.object({
  userId: z.coerce.number().int().positive(),
  enabled: z.preprocess((v) => v === 'true' || v === true, z.boolean()),
});

/**
 * Toggle the per-account "MRP only" flag. When enabled, the user only sees the
 * classic New-Order tab; the B2B Orders tab is hidden. This is a UI-visibility
 * flag read live (fetchMrpOnly), so no session-version bump is needed.
 */
export async function setMrpOnlyAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    const actor = await requireCapability('user:manage');
    await throttleAdminAction(actor.uid, 'mrp');
    const parsed = mrpOnlySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Invalid request.');
    const { userId, enabled } = parsed.data;

    const res = await adminSetMrpOnly({ userId, enabled, actor: actor.uid });
    if (!res.ok) return err(res.message || 'Could not update MRP-only setting.');

    audit({
      kind: 'admin.user.mrp_only',
      actor: actor.uid,
      target: userId,
      enabled,
    });
    revalidatePath('/admin/users');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong updating the MRP-only setting.');
  }
}

// ── Profile-level clinical-significance (telo_profile_interpretation) ────────

/** All active profiles + their current Telo interpretation (admin editor). */
export async function getProfileInterpretationsOverview(): Promise<ProfileInterpRow[]> {
  await requireCapability('user:manage');
  return listProfilesWithInterpretation();
}

const profileInterpSchema = z.object({
  profileId: z.coerce.number().int().positive(),
  interpretation: z.string().max(8000),
});

/** Upsert one profile's clinical-significance text. */
export async function saveProfileInterpretationAction(input: {
  profileId: number;
  interpretation: string;
}): Promise<{ ok: boolean; error?: string }> {
  let actor;
  try {
    actor = await requireCapability('user:manage');
  } catch {
    return { ok: false, error: 'Not authorized.' };
  }
  const parsed = profileInterpSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };
  try {
    await upsertProfileInterpretation(
      parsed.data.profileId,
      parsed.data.interpretation,
      actor.uid,
    );
    audit({
      kind: 'admin.profile_interpretation.save',
      actor: actor.uid,
      target: parsed.data.profileId,
    });
    revalidatePath('/admin/interpretations');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Save failed.' };
  }
}

export type { TeloRole };
