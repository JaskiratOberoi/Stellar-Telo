'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireCapability, throttleAdminAction } from '@/auth/guards';
import {
  fetchAllLisUsertypes,
  fetchLisMenuCatalog,
  fetchUsertypeSecurity,
  AUTH_BIT_LABELS,
  EMPTY_AUTH_BITS,
  type LisAuthBits,
  type LisUsertypeRow,
  type LisMenuTitle,
  type LisMenuItem,
} from '@/db/read/lisSecurity';
import {
  fetchTeloRoles,
  fetchRoleCapsMap,
  fetchLisUsertypeRoleMap,
  invalidateTeloRoleCaches,
  listUserIdsForRole,
  listImplicitUserIdsForLisType,
  type TeloRoleRow,
} from '@/db/read/teloRoles';
import { adminUpsertUsertype, adminSetUsertypeSecurity } from '@/db/sp/lisSecurity';
import {
  adminUpsertTeloRole,
  adminSetTeloRoleCaps,
  adminSetLisUsertypeRole,
} from '@/db/sp/teloRoles';
import { isCapability, ALL_CAPABILITIES } from '@/lib/capabilities';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import type { Capability, TeloRole } from '@/types/auth';
import { redis } from '@/lib/cache';

export type RolesFormState = { error: string | null; ok: boolean; id?: number };
const ok = (id?: number): RolesFormState => ({ error: null, ok: true, id });
const err = (m: string): RolesFormState => ({ error: m, ok: false });

export interface RolesHubData {
  lisUsertypes: LisUsertypeRow[];
  menuTitles: LisMenuTitle[];
  menuItems: LisMenuItem[];
  teloRoles: TeloRoleRow[];
  roleCaps: Record<string, Capability[]>;
  lisRoleMap: Record<number, TeloRole>;
  allCapabilities: typeof ALL_CAPABILITIES;
  authBitLabels: typeof AUTH_BIT_LABELS;
}

export async function getRolesHubData(): Promise<RolesHubData> {
  await requireCapability('user:manage');
  const [lisUsertypes, catalog, teloRoles, roleCaps, lisRoleMap] =
    await Promise.all([
      fetchAllLisUsertypes(),
      fetchLisMenuCatalog(),
      fetchTeloRoles(),
      fetchRoleCapsMap(),
      fetchLisUsertypeRoleMap(),
    ]);
  return {
    lisUsertypes,
    menuTitles: catalog.titles,
    menuItems: catalog.items,
    teloRoles,
    roleCaps,
    lisRoleMap,
    allCapabilities: ALL_CAPABILITIES,
    authBitLabels: AUTH_BIT_LABELS,
  };
}

export async function getUsertypeSecurityAction(usertypeId: number): Promise<{
  menuIds: number[];
  authBits: LisAuthBits;
  error: string | null;
}> {
  await requireCapability('user:manage');
  if (!Number.isInteger(usertypeId) || usertypeId <= 0) {
    return { menuIds: [], authBits: { ...EMPTY_AUTH_BITS }, error: 'Invalid type.' };
  }
  try {
    const sec = await fetchUsertypeSecurity(usertypeId);
    return { ...sec, error: null };
  } catch {
    return {
      menuIds: [],
      authBits: { ...EMPTY_AUTH_BITS },
      error: 'Could not load security for this type.',
    };
  }
}

const usertypeSchema = z.object({
  id: z.coerce.number().int().optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(400).optional(),
  isActive: z.coerce.boolean(),
  force: z.coerce.boolean().optional(),
});

export async function upsertUsertypeAction(
  _prev: RolesFormState,
  formData: FormData,
): Promise<RolesFormState> {
  const actor = await requireCapability('user:manage');
  await throttleAdminAction(actor.uid, 'usertype');
  try {
    const parsed = usertypeSchema.safeParse({
      id: formData.get('id') || undefined,
      name: formData.get('name'),
      description: formData.get('description') || undefined,
      isActive: formData.get('isActive') === '1' || formData.get('isActive') === 'true',
      force: formData.get('force') === '1',
    });
    if (!parsed.success) return err('Check the form fields.');
    const f = parsed.data;
    const res = await adminUpsertUsertype({
      id: f.id && f.id > 0 ? f.id : null,
      name: f.name,
      description: f.description || null,
      isActive: f.isActive,
      force: f.force,
      actor: actor.uid,
    });
    if (!res.ok) return err(res.message || 'Could not save user type.');
    audit({
      kind: 'admin.usertype.upsert',
      actor: actor.uid,
      usertypeId: res.id!,
      name: f.name,
    });
    revalidatePath('/admin/roles');
    return ok(res.id ?? undefined);
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong saving the user type.');
  }
}

const securitySchema = z.object({
  usertype: z.coerce.number().int().positive(),
  menuIdsJson: z.string(),
  authBitsJson: z.string(),
});

export async function setUsertypeSecurityAction(
  _prev: RolesFormState,
  formData: FormData,
): Promise<RolesFormState> {
  const actor = await requireCapability('user:manage');
  await throttleAdminAction(actor.uid, 'usertype_security');
  try {
    const parsed = securitySchema.safeParse({
      usertype: formData.get('usertype'),
      menuIdsJson: formData.get('menuIdsJson') ?? '[]',
      authBitsJson: formData.get('authBitsJson') ?? '{}',
    });
    if (!parsed.success) return err('Invalid security payload.');
    let menuIds: number[] = [];
    let authBits: LisAuthBits = { ...EMPTY_AUTH_BITS };
    try {
      menuIds = (JSON.parse(parsed.data.menuIdsJson) as unknown[])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n > 0);
      authBits = { ...EMPTY_AUTH_BITS, ...JSON.parse(parsed.data.authBitsJson) };
    } catch {
      return err('Invalid JSON in security payload.');
    }
    const res = await adminSetUsertypeSecurity({
      usertype: parsed.data.usertype,
      menuIds,
      authBits,
      actor: actor.uid,
    });
    if (!res.ok) return err(res.message || 'Could not save security.');
    audit({
      kind: 'admin.usertype.security_set',
      actor: actor.uid,
      usertypeId: parsed.data.usertype,
      menuCount: menuIds.length,
    });
    revalidatePath('/admin/roles');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong saving security.');
  }
}

const teloRoleSchema = z.object({
  roleKey: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(400).optional(),
  isActive: z.coerce.boolean(),
});

export async function upsertTeloRoleAction(
  _prev: RolesFormState,
  formData: FormData,
): Promise<RolesFormState> {
  const actor = await requireCapability('user:manage');
  await throttleAdminAction(actor.uid, 'telo_role');
  try {
    const parsed = teloRoleSchema.safeParse({
      roleKey: formData.get('roleKey'),
      label: formData.get('label'),
      description: formData.get('description') || undefined,
      isActive: formData.get('isActive') === '1' || formData.get('isActive') === 'true',
    });
    if (!parsed.success) return err('Check role key / label.');
    const f = parsed.data;
    const res = await adminUpsertTeloRole({
      roleKey: f.roleKey,
      label: f.label,
      description: f.description || null,
      isActive: f.isActive,
      actor: actor.uid,
    });
    if (!res.ok) return err(res.message || 'Could not save Telo role.');
    await invalidateTeloRoleCaches();
    audit({
      kind: 'admin.telo_role.upsert',
      actor: actor.uid,
      roleKey: f.roleKey,
    });
    revalidatePath('/admin/roles');
    revalidatePath('/admin/users');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong saving the Telo role.');
  }
}

export async function setTeloRoleCapsAction(
  _prev: RolesFormState,
  formData: FormData,
): Promise<RolesFormState> {
  const actor = await requireCapability('user:manage');
  await throttleAdminAction(actor.uid, 'telo_role_caps');
  try {
    const roleKey = String(formData.get('roleKey') ?? '')
      .trim()
      .toLowerCase();
    if (!roleKey) return err('Role key required.');
    let caps: string[] = [];
    try {
      caps = (JSON.parse(String(formData.get('capsJson') ?? '[]')) as unknown[])
        .map((c) => String(c))
        .filter(isCapability);
    } catch {
      return err('Invalid capabilities payload.');
    }
    if (roleKey === 'super_admin' && !caps.includes('user:manage')) {
      return err('super_admin must keep user:manage.');
    }
    const res = await adminSetTeloRoleCaps({
      roleKey,
      caps,
      actor: actor.uid,
    });
    if (!res.ok) return err(res.message || 'Could not save capabilities.');
    await invalidateTeloRoleCaches();
    // Bust per-user session caches for anyone on this role.
    try {
      const uids = await listUserIdsForRole(roleKey);
      if (uids.length) {
        await redis().del(...uids.map((id) => `telo:sv:${id}`));
      }
    } catch {
      /* SP already bumped versions; cache bust is best-effort */
    }
    audit({
      kind: 'admin.telo_role.caps_set',
      actor: actor.uid,
      roleKey,
      capCount: caps.length,
    });
    revalidatePath('/admin/roles');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong saving capabilities.');
  }
}

export async function setLisUsertypeRoleAction(
  _prev: RolesFormState,
  formData: FormData,
): Promise<RolesFormState> {
  const actor = await requireCapability('user:manage');
  await throttleAdminAction(actor.uid, 'lis_usertype_role');
  try {
    const lisUsertypeId = Number(formData.get('lisUsertypeId'));
    const teloRoleKey = String(formData.get('teloRoleKey') ?? '')
      .trim()
      .toLowerCase();
    if (!Number.isInteger(lisUsertypeId) || lisUsertypeId <= 0 || !teloRoleKey) {
      return err('Pick a LIS type and Telo role.');
    }
    const res = await adminSetLisUsertypeRole({
      lisUsertypeId,
      teloRoleKey,
      actor: actor.uid,
    });
    if (!res.ok) return err(res.message || 'Could not save mapping.');
    await invalidateTeloRoleCaches();
    try {
      const uids = await listImplicitUserIdsForLisType(lisUsertypeId);
      if (uids.length) {
        await redis().del(...uids.map((id) => `telo:sv:${id}`));
      }
    } catch {
      /* SP already bumped versions; cache bust is best-effort */
    }
    audit({
      kind: 'admin.lis_usertype_role.set',
      actor: actor.uid,
      lisUsertypeId,
      teloRole: teloRoleKey,
    });
    revalidatePath('/admin/roles');
    revalidatePath('/admin/users');
    return ok();
  } catch (e) {
    if (e instanceof AppError) return err(e.message);
    return err('Something went wrong saving the mapping.');
  }
}
