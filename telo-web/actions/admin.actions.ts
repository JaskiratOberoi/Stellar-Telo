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
  adminCreateUser,
  adminSetRole,
  adminResetPassword,
  adminSetActive,
} from '@/db/sp/adminUsers';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import type { TeloRole } from '@/types/auth';

export interface AdminOverview {
  users: TeloUserRow[];
  lisUsertypes: LisUsertype[];
  fetchedAt: string;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  await requireCapability('user:manage');
  const [users, lisUsertypes] = await Promise.all([
    listTeloUsers(),
    fetchLisUsertypes(),
  ]);
  return { users, lisUsertypes, fetchedAt: new Date().toISOString() };
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
});

export async function createUserAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    const actor = await requireCapability('user:manage');
    const parsed = createSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return err('Please fill all required fields.');
    const f = parsed.data;

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

    audit({
      kind: 'admin.user.create',
      actor: actor.uid,
      target: res.userId,
      role: f.teloRole,
      lisUsertypeId: f.lisUsertypeId,
    });
    revalidatePath('/admin/users');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong creating the user.');
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
