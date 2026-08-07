'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import {
  getUsertypeSecurityAction,
  upsertUsertypeAction,
  setUsertypeSecurityAction,
  upsertTeloRoleAction,
  setTeloRoleCapsAction,
  setLisUsertypeRoleAction,
  type RolesHubData,
  type RolesFormState,
} from '@/actions/roles.actions';
import type { LisAuthBits } from '@/lib/lis-security';
import { EMPTY_AUTH_BITS } from '@/lib/lis-security';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Capability } from '@/types/auth';

const initial: RolesFormState = { error: null, ok: false };
const sel =
  'h-9 w-full rounded-md border border-foreground/10 bg-input px-3 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50';

type Tab = 'lis' | 'telo';

export function RolesHub({ initial: data }: { initial: RolesHubData }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [tab, setTab] = useState<Tab>('lis');
  const [q, setQ] = useState('');

  if (!mounted) {
    return (
      <div className="h-96 animate-pulse rounded-xl border border-foreground/5 bg-foreground/[0.04]" />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-foreground/10 pb-2">
        <TabBtn active={tab === 'lis'} onClick={() => setTab('lis')}>
          LIS levels
        </TabBtn>
        <TabBtn active={tab === 'telo'} onClick={() => setTab('telo')}>
          Telo roles
        </TabBtn>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tab === 'lis' ? 'Search LIS user types…' : 'Search Telo roles…'}
          className="max-w-xs"
        />
      </div>

      {tab === 'lis' ? (
        <LisLevelsTab data={data} query={q} />
      ) : (
        <TeloRolesTab data={data} query={q} />
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  LIS levels                                                         */
/* ------------------------------------------------------------------ */

function LisLevelsTab({ data, query }: { data: RolesHubData; query: string }) {
  const [editId, setEditId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [securityId, setSecurityId] = useState<number | null>(null);

  const rows = useMemo(() => {
    const n = query.trim().toLowerCase();
    return data.lisUsertypes.filter(
      (u) =>
        !n ||
        u.name.toLowerCase().includes(n) ||
        String(u.id).includes(n) ||
        (u.description ?? '').toLowerCase().includes(n),
    );
  }, [data.lisUsertypes, query]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          Add LIS user type
        </Button>
      </div>

      {(creating || editId != null) && (
        <UsertypeForm
          key={editId ?? 'new'}
          initial={
            editId != null
              ? data.lisUsertypes.find((u) => u.id === editId) ?? null
              : null
          }
          onClose={() => {
            setCreating(false);
            setEditId(null);
          }}
        />
      )}

      {securityId != null && (
        <LisSecurityEditor
          key={securityId}
          usertypeId={securityId}
          usertypeName={
            data.lisUsertypes.find((u) => u.id === securityId)?.name ?? ''
          }
          data={data}
          onClose={() => setSecurityId(null)}
        />
      )}

      <div className="overflow-x-auto rounded-md border border-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User type</TableHead>
              <TableHead>Default Telo role</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    id {u.id}
                    {u.description ? ` · ${u.description}` : ''}
                  </div>
                </TableCell>
                <TableCell>
                  <LisDefaultRolePicker
                    lisUsertypeId={u.id}
                    current={data.lisRoleMap[u.id] ?? 'viewer'}
                    teloRoles={data.teloRoles}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {u.userCount}
                </TableCell>
                <TableCell>
                  <StatusPill active={u.isActive} />
                </TableCell>
                <TableCell className="space-x-2 text-right text-sm">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setSecurityId(u.id)}
                  >
                    Permissions
                  </button>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      setCreating(false);
                      setEditId(u.id);
                    }}
                  >
                    Edit
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function UsertypeForm({
  initial,
  onClose,
}: {
  initial: RolesHubData['lisUsertypes'][number] | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(upsertUsertypeAction, {
    error: null,
    ok: false,
  });
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <form
      action={action}
      className="space-y-3 rounded-md border border-foreground/10 bg-foreground/[0.02] p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {initial ? `Edit “${initial.name}”` : 'New LIS user type'}
        </h3>
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={onClose}>
          Cancel
        </button>
      </div>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-0.5">
          <Label htmlFor="ut-name">Name *</Label>
          <Input
            id="ut-name"
            name="name"
            required
            maxLength={100}
            defaultValue={initial?.name ?? ''}
          />
        </div>
        <div className="space-y-0.5">
          <Label htmlFor="ut-desc">Description</Label>
          <Input
            id="ut-desc"
            name="description"
            maxLength={400}
            defaultValue={initial?.description ?? ''}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          value="1"
          defaultChecked={initial?.isActive ?? true}
          disabled={initial?.id === 1}
        />
        Active
      </label>
      {initial && initial.userCount > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" name="force" value="1" />
          Force deactivate even with {initial.userCount} user(s) assigned
        </label>
      )}
      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      <Button type="submit" disabled={pending} size="sm">
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}

function LisDefaultRolePicker({
  lisUsertypeId,
  current,
  teloRoles,
}: {
  lisUsertypeId: number;
  current: string;
  teloRoles: RolesHubData['teloRoles'];
}) {
  const [state, action, pending] = useActionState(setLisUsertypeRoleAction, initial);
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="lisUsertypeId" value={lisUsertypeId} />
      <select
        name="teloRoleKey"
        className={sel + ' h-8 max-w-[11rem] text-xs'}
        defaultValue={current}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {teloRoles
          .filter((r) => r.isActive)
          .map((r) => (
            <option key={r.roleKey} value={r.roleKey}>
              {r.label}
            </option>
          ))}
      </select>
      {state.error && (
        <span className="text-[10px] text-destructive">{state.error}</span>
      )}
    </form>
  );
}

function LisSecurityEditor({
  usertypeId,
  usertypeName,
  data,
  onClose,
}: {
  usertypeId: number;
  usertypeName: string;
  data: RolesHubData;
  onClose: () => void;
}) {
  const [menuIds, setMenuIds] = useState<Set<number>>(new Set());
  const [authBits, setAuthBits] = useState<LisAuthBits>({ ...EMPTY_AUTH_BITS });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, action, pending] = useActionState(setUsertypeSecurityAction, initial);
  const [, start] = useTransition();

  useEffect(() => {
    start(async () => {
      setLoading(true);
      const res = await getUsertypeSecurityAction(usertypeId);
      if (res.error) setLoadError(res.error);
      setMenuIds(new Set(res.menuIds));
      setAuthBits(res.authBits);
      setLoading(false);
    });
  }, [usertypeId]);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  function toggle(id: number) {
    setMenuIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleColumn(titleId: number, on: boolean) {
    const ids = data.menuItems.filter((m) => m.titleId === titleId).map((m) => m.id);
    setMenuIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  return (
    <form
      action={action}
      className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          LIS permissions — {usertypeName}
        </h3>
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={onClose}>
          Close
        </button>
      </div>
      <input type="hidden" name="usertype" value={usertypeId} />
      <input type="hidden" name="menuIdsJson" value={JSON.stringify([...menuIds])} />
      <input type="hidden" name="authBitsJson" value={JSON.stringify(authBits)} />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-6">
            {data.menuTitles.map((title) => {
              const items = data.menuItems.filter((m) => m.titleId === title.id);
              const allOn = items.length > 0 && items.every((m) => menuIds.has(m.id));
              return (
                <div key={title.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {title.name}
                    </p>
                    <button
                      type="button"
                      className="text-[10px] text-primary hover:underline"
                      onClick={() => toggleColumn(title.id, !allOn)}
                    >
                      {allOn ? 'Clear' : 'All'}
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {items.map((m) => (
                      <li key={m.id}>
                        <label className="flex items-start gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={menuIds.has(m.id)}
                            onChange={() => toggle(m.id)}
                          />
                          <span>{m.label}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5 border-t border-foreground/10 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Action permissions
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {data.authBitLabels.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={!!authBits[key]}
                    onChange={(e) =>
                      setAuthBits((b) => ({ ...b, [key]: e.target.checked }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </>
      )}

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" size="sm" disabled={pending || loading}>
        {pending ? 'Saving…' : 'Save permissions'}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Telo roles                                                         */
/* ------------------------------------------------------------------ */

function TeloRolesTab({ data, query }: { data: RolesHubData; query: string }) {
  const [editKey, setEditKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [capsKey, setCapsKey] = useState<string | null>(null);

  const rows = useMemo(() => {
    const n = query.trim().toLowerCase();
    return data.teloRoles.filter(
      (r) =>
        !n ||
        r.roleKey.includes(n) ||
        r.label.toLowerCase().includes(n) ||
        (r.description ?? '').toLowerCase().includes(n),
    );
  }, [data.teloRoles, query]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          Add Telo role
        </Button>
      </div>

      {(creating || editKey != null) && (
        <TeloRoleForm
          key={editKey ?? 'new'}
          initial={
            editKey != null
              ? data.teloRoles.find((r) => r.roleKey === editKey) ?? null
              : null
          }
          onClose={() => {
            setCreating(false);
            setEditKey(null);
          }}
        />
      )}

      {capsKey != null && (
        <TeloCapsEditor
          key={capsKey}
          roleKey={capsKey}
          label={data.teloRoles.find((r) => r.roleKey === capsKey)?.label ?? capsKey}
          caps={data.roleCaps[capsKey] ?? []}
          allCapabilities={data.allCapabilities}
          onClose={() => setCapsKey(null)}
        />
      )}

      <div className="overflow-x-auto rounded-md border border-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Key</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead>Caps</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.roleKey}>
                <TableCell>
                  <div className="font-medium">{r.label}</div>
                  {r.description && (
                    <div className="text-[11px] text-muted-foreground">
                      {r.description}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.roleKey}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.userCount}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {(data.roleCaps[r.roleKey] ?? []).length}
                </TableCell>
                <TableCell>
                  <StatusPill active={r.isActive} />
                  {r.isBuiltin && (
                    <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                      built-in
                    </span>
                  )}
                </TableCell>
                <TableCell className="space-x-2 text-right text-sm">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setCapsKey(r.roleKey)}
                  >
                    Permissions
                  </button>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      setCreating(false);
                      setEditKey(r.roleKey);
                    }}
                  >
                    Edit
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function TeloRoleForm({
  initial,
  onClose,
}: {
  initial: RolesHubData['teloRoles'][number] | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(upsertTeloRoleAction, {
    error: null,
    ok: false,
  });
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <form
      action={action}
      className="space-y-3 rounded-md border border-foreground/10 bg-foreground/[0.02] p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {initial ? `Edit “${initial.label}”` : 'New Telo role'}
        </h3>
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-0.5">
          <Label htmlFor="tr-key">Key *</Label>
          <Input
            id="tr-key"
            name="roleKey"
            required
            maxLength={40}
            pattern="[a-z][a-z0-9_]*"
            defaultValue={initial?.roleKey ?? ''}
            readOnly={!!initial}
            className={initial ? 'opacity-70' : undefined}
            placeholder="e.g. phlebotomy"
          />
        </div>
        <div className="space-y-0.5">
          <Label htmlFor="tr-label">Label *</Label>
          <Input
            id="tr-label"
            name="label"
            required
            maxLength={100}
            defaultValue={initial?.label ?? ''}
          />
        </div>
      </div>
      <div className="space-y-0.5">
        <Label htmlFor="tr-desc">Description</Label>
        <Input
          id="tr-desc"
          name="description"
          maxLength={400}
          defaultValue={initial?.description ?? ''}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          value="1"
          defaultChecked={initial?.isActive ?? true}
          disabled={initial?.roleKey === 'super_admin'}
        />
        Active
      </label>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} size="sm">
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}

function TeloCapsEditor({
  roleKey,
  label,
  caps,
  allCapabilities,
  onClose,
}: {
  roleKey: string;
  label: string;
  caps: Capability[];
  allCapabilities: RolesHubData['allCapabilities'];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(caps));
  const [state, action, pending] = useActionState(setTeloRoleCapsAction, initial);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof allCapabilities>();
    for (const c of allCapabilities) {
      const list = map.get(c.group) ?? [];
      list.push(c);
      map.set(c.group, list);
    }
    return [...map.entries()];
  }, [allCapabilities]);

  function toggle(cap: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  }

  return (
    <form
      action={action}
      className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Telo permissions — {label}
        </h3>
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={onClose}>
          Close
        </button>
      </div>
      <input type="hidden" name="roleKey" value={roleKey} />
      <input
        type="hidden"
        name="capsJson"
        value={JSON.stringify([...selected])}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(([group, items]) => (
          <div key={group} className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </p>
            <ul className="space-y-1">
              {items.map((c) => (
                <li key={c.value}>
                  <label className="flex items-start gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected.has(c.value)}
                      disabled={
                        roleKey === 'super_admin' && c.value === 'user:manage'
                      }
                      onChange={() => toggle(c.value)}
                    />
                    <span>
                      {c.label}{' '}
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {c.value}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save permissions'}
      </Button>
    </form>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        active
          ? 'bg-emerald-500/15 text-emerald-400'
          : 'bg-destructive/15 text-destructive'
      }`}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}
