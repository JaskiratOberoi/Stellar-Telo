'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/auth/guards';
import {
  listTeloUsers,
  fetchLisUsertypes,
  type TeloUserRow,
  type LisUsertype,
} from '@/db/read/teloUsers';
import {
  fetchAllActiveMccs,
  type ScopedMcc,
} from '@/db/read/mccUnits';
import {
  adminCreateUser,
  adminSetRole,
  adminResetPassword,
  adminSetActive,
} from '@/db/sp/adminUsers';
import { getPool, sql, withRetry } from '@/db/pool';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import type { TeloRole } from '@/types/auth';

export interface AdminOverview {
  users: TeloUserRow[];
  lisUsertypes: LisUsertype[];
  /** All active MCC units — used by the Add User form to assign client-code scope. */
  allMccs: ScopedMcc[];
  fetchedAt: string;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  await requireCapability('user:manage');
  const [users, lisUsertypes, allMccs] = await Promise.all([
    listTeloUsers(),
    fetchLisUsertypes(),
    fetchAllActiveMccs(),
  ]);
  return {
    users,
    lisUsertypes,
    allMccs,
    fetchedAt: new Date().toISOString(),
  };
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
}

const teloRoleSchema = z.enum([
  'super_admin',
  'admin',
  'billing',
  'technician',
  'viewer',
]);

export type AdminFormState = { error: string | null; ok: boolean };
const ok = (): AdminFormState => ({ error: null, ok: true });
const err = (m: string): AdminFormState => ({ error: m, ok: false });

const createSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().trim().min(4).max(50),
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
    const parsed = createSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Please fill all required fields.');
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
    const parsed = setRoleSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Invalid role change.');
    const { userId, teloRole } = parsed.data;

    const res = await adminSetRole({ userId, teloRole, actor: actor.uid });
    if (!res.ok) return err(res.message || 'Could not update the role.');

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
  newPassword: z.string().trim().min(4).max(50),
});

export async function resetPasswordAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    const actor = await requireCapability('user:manage');
    const parsed = resetSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Enter a password of 4+ characters.');
    const { userId, newPassword } = parsed.data;

    const res = await adminResetPassword({
      userId,
      newPassword,
      actor: actor.uid,
    });
    if (!res.ok) return err(res.message || 'Could not reset the password.');

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
    const parsed = activeSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Invalid request.');
    const { userId, active } = parsed.data;

    const res = await adminSetActive({ userId, active, actor: actor.uid });
    if (!res.ok) return err(res.message || 'Could not update the user.');

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

export type { TeloRole };
