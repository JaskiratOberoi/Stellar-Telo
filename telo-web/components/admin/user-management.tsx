'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  createUserAction,
  setRoleAction,
  resetPasswordAction,
  setActiveAction,
  setLisAccessAction,
  updateUserAction,
  getEditableUserScope,
  searchMccUnitsAction,
  fetchMccUnitsByIdsAction,
  type AdminFormState,
  type AdminOverview,
} from '@/actions/admin.actions';
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
import type { TeloRole } from '@/types/auth';
import { lisUsertypeToTeloRole } from '@/auth/rbac';
import { fmtIST } from '@/lib/datetime';
import { RemoteCombobox } from '@/components/ui/remote-combobox';
import type { ScopedMcc } from '@/db/read/mccUnits';

const initial: AdminFormState = { error: null, ok: false };
const sel =
  'h-9 w-full rounded-md border border-white/10 bg-input px-3 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50';

const ROLES: { value: TeloRole; label: string; hint: string }[] = [
  { value: 'super_admin', label: 'Super Admin', hint: 'All access + user mgmt' },
  { value: 'admin', label: 'Admin', hint: 'Everything except user mgmt' },
  { value: 'billing', label: 'Billing', hint: 'Register + accession + payments' },
  { value: 'technician', label: 'Technician', hint: 'Accession SIDs only' },
  { value: 'viewer', label: 'Viewer', hint: 'Read-only' },
];

export function UserManagement({
  initial: overview,
  currentUid,
}: {
  initial: AdminOverview;
  currentUid: number;
}) {
  // Client-only mount — browser form-fillers mutate SSR HTML pre-hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<TeloRole | 'unassigned' | 'all'>(
    'all',
  );
  const [lisRoleFilter, setLisRoleFilter] = useState<number | 'all'>('all');
  const [activeFilter, setActiveFilter] = useState<
    'active' | 'inactive' | 'all'
  >('active');
  const [createOpen, setCreateOpen] = useState(false);

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  // Reset to page 1 whenever any filter changes.
  useEffect(() => {
    setPage(1);
  }, [q, roleFilter, lisRoleFilter, activeFilter]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return overview.users.filter((u) => {
      if (activeFilter === 'active' && !u.teloActive) return false;
      if (activeFilter === 'inactive' && u.teloActive) return false;
      if (lisRoleFilter !== 'all' && u.lisUsertypeId !== lisRoleFilter)
        return false;
      // Telo role filter matches on the EFFECTIVE role — explicit row, else
      // derived from the LIS usertypeid. 'unassigned' = no explicit row.
      if (roleFilter === 'unassigned' && u.teloRole != null) return false;
      if (
        roleFilter !== 'all' &&
        roleFilter !== 'unassigned' &&
        (u.teloRole ?? lisUsertypeToTeloRole(u.lisUsertypeId)) !== roleFilter
      )
        return false;
      if (!needle) return true;
      const effective =
        u.teloRole ?? lisUsertypeToTeloRole(u.lisUsertypeId);
      return (
        u.username.toLowerCase().includes(needle) ||
        (u.firstName ?? '').toLowerCase().includes(needle) ||
        (u.lastName ?? '').toLowerCase().includes(needle) ||
        (u.email ?? '').toLowerCase().includes(needle) ||
        effective.toLowerCase().includes(needle) ||
        (u.lisUsertypeName ?? '').toLowerCase().includes(needle)
      );
    });
  }, [overview.users, q, roleFilter, lisRoleFilter, activeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  if (!mounted) {
    return <div className="h-96 animate-pulse rounded-xl border border-white/5 bg-white/[0.04]" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5">
            <Label className="block text-xs text-muted-foreground">Search</Label>
            <Input
              placeholder="Username, name, email, role…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 w-72"
              suppressHydrationWarning
            />
          </div>
          <div className="space-y-0.5">
            <Label className="block text-xs text-muted-foreground">Telo role</Label>
            <select
              value={roleFilter}
              onChange={(e) =>
                setRoleFilter(e.target.value as TeloRole | 'unassigned' | 'all')
              }
              suppressHydrationWarning
              className={sel + ' h-8 w-44'}
            >
              <option value="all">All roles</option>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
              <option value="unassigned">— Unassigned —</option>
            </select>
          </div>
          <div className="space-y-0.5">
            <Label className="block text-xs text-muted-foreground">LIS role</Label>
            <select
              value={lisRoleFilter === 'all' ? 'all' : String(lisRoleFilter)}
              onChange={(e) =>
                setLisRoleFilter(
                  e.target.value === 'all' ? 'all' : Number(e.target.value),
                )
              }
              suppressHydrationWarning
              className={sel + ' h-8 w-48'}
            >
              <option value="all">All LIS roles</option>
              {overview.lisUsertypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-0.5">
            <Label className="block text-xs text-muted-foreground">Status</Label>
            <select
              value={activeFilter}
              onChange={(e) =>
                setActiveFilter(
                  e.target.value as 'active' | 'inactive' | 'all',
                )
              }
              suppressHydrationWarning
              className={sel + ' h-8 w-32'}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {filtered.length.toLocaleString('en-IN')} of{' '}
            {overview.users.length.toLocaleString('en-IN')} ·{' '}
            updated {fmtIST(overview.fetchedAt, 'time')} IST
          </span>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            + Add user
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">Username</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-44">LIS role</TableHead>
            <TableHead className="w-40">Telo role</TableHead>
            <TableHead className="w-20 text-center">Active</TableHead>
            <TableHead className="w-28 text-center">LIS access</TableHead>
            <TableHead className="w-56">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-muted-foreground">
                {overview.users.length === 0
                  ? 'No Telo users yet — click "Add user" to onboard one.'
                  : 'No users match these filters.'}
              </TableCell>
            </TableRow>
          ) : (
            pageRows.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isSelf={u.id === currentUid}
              />
            ))
          )}
        </TableBody>
      </Table>

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {pageStart + 1}–
            {Math.min(pageStart + PAGE_SIZE, filtered.length)} of{' '}
            {filtered.length.toLocaleString('en-IN')}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 1}
              onClick={() => setPage(1)}
            >
              « First
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹ Prev
            </Button>
            <span className="px-2">
              Page {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next ›
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === totalPages}
              onClick={() => setPage(totalPages)}
            >
              Last »
            </Button>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateUserPanel
          lisUsertypes={overview.lisUsertypes}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}

function UserRow({
  user,
  isSelf,
}: {
  user: AdminOverview['users'][number];
  isSelf: boolean;
}) {
  const [openRow, setOpenRow] = useState<
    null | 'role' | 'password' | 'edit'
  >(null);

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-xs">{user.username}</TableCell>
        <TableCell>
          {[user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
            '—'}
          {user.email && (
            <span className="ml-2 text-xs text-muted-foreground">
              {user.email}
            </span>
          )}
        </TableCell>
        <TableCell className="text-xs">
          {user.lisUsertypeName ?? '—'}
        </TableCell>
        <TableCell>
          {user.teloRole ? (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
              {labelFor(user.teloRole)}
            </span>
          ) : (
            <span
              className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
              title="Derived from the LIS user type — no explicit Telo role assigned yet."
            >
              {labelFor(lisUsertypeToTeloRole(user.lisUsertypeId))}
              <span className="ml-1 opacity-60 italic">(from LIS)</span>
            </span>
          )}
        </TableCell>
        <TableCell className="text-center">
          {user.teloActive ? (
            <span className="text-xs text-secondary">Yes</span>
          ) : (
            <span className="text-xs text-destructive">No</span>
          )}
        </TableCell>
        <TableCell className="text-center">
          {user.hasTeloAccount ? (
            user.lisAccess ? (
              <span
                className="text-xs text-secondary"
                title="This Telo account can sign in to the LIS."
              >
                Enabled
              </span>
            ) : (
              <span
                className="text-xs text-amber-500"
                title="LIS-locked — these credentials cannot sign in to the LIS."
              >
                Locked
              </span>
            )
          ) : (
            <span
              className="text-xs text-muted-foreground"
              title="Native LIS account — LIS access is managed in the LIS."
            >
              —
            </span>
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {/* LIS access toggle — only for Telo-managed accounts. */}
            {user.hasTeloAccount && (
              <SetLisAccessButton
                userId={user.id}
                enabled={!user.lisAccess}
              />
            )}
            {/* Edit is Telo-only — see updateUserAction guard. */}
            {user.createdByTelo && (
              <button
                type="button"
                onClick={() =>
                  setOpenRow(openRow === 'edit' ? null : 'edit')
                }
                className="text-primary hover:underline"
                title="Edit name, email, and client-code scope"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpenRow(openRow === 'role' ? null : 'role')}
              className="text-primary hover:underline"
            >
              Role
            </button>
            <button
              type="button"
              onClick={() =>
                setOpenRow(openRow === 'password' ? null : 'password')
              }
              className="text-primary hover:underline"
            >
              Reset password
            </button>
            <SetActiveButton
              userId={user.id}
              active={!user.teloActive}
              disabled={isSelf}
            />
          </div>
        </TableCell>
      </TableRow>
      {openRow === 'edit' && user.createdByTelo && (
        <TableRow>
          <TableCell colSpan={7} className="bg-white/[0.03]">
            <EditUserForm
              user={user}
              onDone={() => setOpenRow(null)}
            />
          </TableCell>
        </TableRow>
      )}
      {openRow === 'role' && (
        <TableRow>
          <TableCell colSpan={7} className="bg-white/[0.03]">
            <SetRoleForm
              userId={user.id}
              current={user.teloRole}
              onDone={() => setOpenRow(null)}
            />
          </TableCell>
        </TableRow>
      )}
      {openRow === 'password' && (
        <TableRow>
          <TableCell colSpan={7} className="bg-white/[0.03]">
            <ResetPasswordForm
              userId={user.id}
              username={user.username}
              onDone={() => setOpenRow(null)}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function labelFor(role: TeloRole): string {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

function SetRoleForm({
  userId,
  current,
  onDone,
}: {
  userId: number;
  current: TeloRole | null;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(setRoleAction, initial);
  const [role, setRole] = useState<TeloRole>(current ?? 'viewer');

  useEffect(() => {
    if (state.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 py-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="space-y-0.5">
        <Label>Telo role</Label>
        <select
          name="teloRole"
          value={role}
          onChange={(e) => setRole(e.target.value as TeloRole)}
          suppressHydrationWarning
          className={sel + ' w-56'}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label} — {r.hint}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save role'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onDone}
        disabled={pending}
      >
        Cancel
      </Button>
      {state.error && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </form>
  );
}

function EditUserForm({
  user,
  onDone,
}: {
  user: AdminOverview['users'][number];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(updateUserAction, initial);
  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [pickedMccIds, setPickedMccIds] = useState<number[]>([]);
  const [pickerValue, setPickerValue] = useState<number | ''>('');
  const [scopeLoading, setScopeLoading] = useState(true);
  const [scopeError, setScopeError] = useState<string | null>(null);
  // Chip-label cache: only the picked MCCs need to be display-resolved.
  // Hydrated from the picked-ids resolver on mount and from each pick.
  const [mccLabels, setMccLabels] = useState<Map<number, ScopedMcc>>(
    () => new Map(),
  );

  // Pull current MCC scope on mount — the listTeloUsers payload doesn't
  // ship it (would be ~3.5k × N MCC IDs in the admin overview otherwise).
  useEffect(() => {
    let cancelled = false;
    setScopeLoading(true);
    setScopeError(null);
    getEditableUserScope(user.id)
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setScopeError(r.error ?? 'Could not load scope.');
          return;
        }
        setPickedMccIds(r.mccIds);
        if (r.mccIds.length > 0) {
          try {
            const rows = await fetchMccUnitsByIdsAction(r.mccIds);
            if (cancelled) return;
            setMccLabels((prev) => {
              const m = new Map(prev);
              for (const x of rows) m.set(x.id, x);
              return m;
            });
          } catch {
            /* chip labels degrade to id-only — no need to surface */
          }
        }
      })
      .catch(() => {
        if (!cancelled) setScopeError('Could not load scope.');
      })
      .finally(() => {
        if (!cancelled) setScopeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  useEffect(() => {
    if (state.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  function addMcc(id: number | '', label?: ScopedMcc) {
    if (id === '' || pickedMccIds.includes(id)) return;
    setPickedMccIds((p) => [...p, id]);
    if (label) {
      setMccLabels((prev) => {
        const m = new Map(prev);
        m.set(id, label);
        return m;
      });
    }
    setPickerValue('');
  }
  function removeMcc(id: number) {
    setPickedMccIds((p) => p.filter((x) => x !== id));
  }

  const effectiveRole =
    user.teloRole ?? lisUsertypeToTeloRole(user.lisUsertypeId);
  const scopeIsUnrestricted =
    effectiveRole === 'super_admin' || effectiveRole === 'admin';

  return (
    <form action={action} className="space-y-3 py-2">
      <input type="hidden" name="userId" value={user.id} />
      <input
        type="hidden"
        name="mccIdsCsv"
        value={pickedMccIds.join(',')}
      />
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-0.5">
          <Label htmlFor={`fn-${user.id}`}>First name *</Label>
          <Input
            id={`fn-${user.id}`}
            name="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            maxLength={100}
          />
        </div>
        <div className="space-y-0.5">
          <Label htmlFor={`ln-${user.id}`}>Last name</Label>
          <Input
            id={`ln-${user.id}`}
            name="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            maxLength={100}
          />
        </div>
        <div className="space-y-0.5">
          <Label htmlFor={`em-${user.id}`}>Email</Label>
          <Input
            id={`em-${user.id}`}
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={100}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Client codes (MCC scope)</Label>
        {scopeIsUnrestricted ? (
          <p className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground">
            {labelFor(effectiveRole)} accounts have{' '}
            <span className="font-medium text-foreground">unrestricted</span>{' '}
            MCC scope — assignments here only matter if the role is downgraded
            later.
          </p>
        ) : scopeLoading ? (
          <p className="text-xs text-muted-foreground">Loading scope…</p>
        ) : scopeError ? (
          <p className="text-xs text-destructive">{scopeError}</p>
        ) : (
          <>
            {pickedMccIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pickedMccIds.map((id) => {
                  const m = mccLabels.get(id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs"
                    >
                      <span className="font-medium">{m?.name ?? id}</span>
                      {m?.code && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {m.code}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeMcc(id)}
                        className="ml-0.5 text-muted-foreground hover:text-destructive"
                        aria-label="Remove"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <RemoteCombobox
              search={(q) => searchMccUnitsAction(q, pickedMccIds).then((rows) => {
                // Cache labels for any rows the user might pick so the chip
                // renders with a name immediately, not just an id.
                setMccLabels((prev) => {
                  const m = new Map(prev);
                  for (const x of rows) m.set(x.id, x);
                  return m;
                });
                return rows;
              })}
              value={pickerValue}
              onChange={(id) =>
                addMcc(
                  id,
                  id === '' ? undefined : mccLabels.get(id) ?? undefined,
                )
              }
              placeholder={
                pickedMccIds.length === 0
                  ? 'Search client codes…'
                  : 'Add another client code…'
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Saving replaces this user&apos;s MCC scope with the chips above
              (existing entries not shown are removed).
            </p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={pending || scopeLoading}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDone}
          disabled={pending}
        >
          Cancel
        </Button>
        {state.error && (
          <span className="text-xs text-destructive">{state.error}</span>
        )}
      </div>
    </form>
  );
}

function ResetPasswordForm({
  userId,
  username,
  onDone,
}: {
  userId: number;
  username: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(resetPasswordAction, initial);
  const [pwd, setPwd] = useState('');

  useEffect(() => {
    if (state.ok) {
      setPwd('');
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 py-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="space-y-0.5">
        <Label>New password for {username}</Label>
        <Input
          name="newPassword"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          minLength={12}
          maxLength={72}
          required
          className="w-64"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Set password'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onDone}
        disabled={pending}
      >
        Cancel
      </Button>
      {state.error && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </form>
  );
}

function SetActiveButton({
  userId,
  active,
  disabled,
}: {
  userId: number;
  active: boolean; // target state (toggle)
  disabled: boolean;
}) {
  const [, action, pending] = useActionState(setActiveAction, initial);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="active" value={active ? 'true' : 'false'} />
      <button
        type="submit"
        disabled={disabled || pending}
        title={disabled ? 'You cannot deactivate yourself' : undefined}
        className="text-destructive hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
      >
        {active ? 'Activate' : 'Deactivate'}
      </button>
    </form>
  );
}

function SetLisAccessButton({
  userId,
  enabled,
}: {
  userId: number;
  enabled: boolean; // target state (toggle): true = grant LIS access
}) {
  const [, action, pending] = useActionState(setLisAccessAction, initial);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
      <button
        type="submit"
        disabled={pending}
        title={
          enabled
            ? 'Allow this Telo account to sign in to the LIS'
            : 'Block this Telo account from signing in to the LIS'
        }
        className={
          enabled
            ? 'text-secondary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline'
            : 'text-amber-500 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline'
        }
      >
        {enabled ? 'Enable LIS' : 'Lock LIS'}
      </button>
    </form>
  );
}

function CreateUserPanel({
  lisUsertypes,
  onClose,
}: {
  lisUsertypes: AdminOverview['lisUsertypes'];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(createUserAction, initial);
  // Selected MCC IDs (ordered, no dupes). Super Admin / Admin get
  // unrestricted scope from the LIS usertype anyway, so the picker is most
  // relevant for Billing / Technician / Viewer roles.
  const [pickedMccIds, setPickedMccIds] = useState<number[]>([]);
  const [pickerValue, setPickerValue] = useState<number | ''>('');
  const [teloRole, setTeloRole] = useState<TeloRole>('viewer');
  // Chip-label cache populated by RemoteCombobox results (server search).
  const [mccLabels, setMccLabels] = useState<Map<number, ScopedMcc>>(
    () => new Map(),
  );

  useEffect(() => {
    if (state.ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  // Default LIS usertype: CLIENT REPORTING (8) when present, else first.
  const defaultLisId =
    lisUsertypes.find((t) => t.id === 8)?.id ?? lisUsertypes[0]?.id ?? '';

  function addMcc(id: number | '', label?: ScopedMcc) {
    if (id === '' || pickedMccIds.includes(id)) return;
    setPickedMccIds((p) => [...p, id]);
    if (label) {
      setMccLabels((prev) => {
        const m = new Map(prev);
        m.set(id, label);
        return m;
      });
    }
    setPickerValue('');
  }
  function removeMcc(id: number) {
    setPickedMccIds((p) => p.filter((x) => x !== id));
  }

  const scopeIsUnrestricted = teloRole === 'super_admin' || teloRole === 'admin';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <form
        action={action}
        className="w-full max-w-md space-y-2.5 rounded-2xl border border-white/5 bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200"
      >
        <input type="hidden" name="mccIdsCsv" value={pickedMccIds.join(',')} />
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Onboard a new Telo user</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Creates the LIS login (plaintext password — see security notes) and
          assigns a Telo role. The LIS user type defaults to CLIENT REPORTING
          (minimal LIS rights).
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <Label htmlFor="username">Username *</Label>
            <Input id="username" name="username" required maxLength={50} />
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="password">Password *</Label>
            <Input
              id="password"
              name="password"
              required
              minLength={12}
              maxLength={72}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <Label htmlFor="firstName">First name *</Label>
            <Input id="firstName" name="firstName" required maxLength={100} />
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" name="lastName" maxLength={100} />
          </div>
        </div>

        <div className="space-y-0.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" maxLength={100} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <Label>Telo role *</Label>
            <select
              name="teloRole"
              value={teloRole}
              onChange={(e) => setTeloRole(e.target.value as TeloRole)}
              className={sel}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-0.5">
            <Label>LIS user type *</Label>
            <select
              name="lisUsertypeId"
              defaultValue={defaultLisId}
              className={sel}
            >
              {lisUsertypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Client-code (MCC) scope ───────────────────────────────── */}
        <div className="space-y-1 pt-1">
          <Label>Client codes (MCC scope)</Label>
          {scopeIsUnrestricted ? (
            <p className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground">
              {ROLES.find((r) => r.value === teloRole)?.label} accounts have{' '}
              <span className="font-medium text-foreground">unrestricted</span>{' '}
              MCC scope — no selection needed.
            </p>
          ) : (
            <>
              {pickedMccIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pickedMccIds.map((id) => {
                    const m = mccLabels.get(id);
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs"
                      >
                        <span className="font-medium">{m?.name ?? id}</span>
                        {m?.code && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {m.code}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeMcc(id)}
                          className="ml-0.5 text-muted-foreground hover:text-destructive"
                          aria-label="Remove"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <RemoteCombobox
                search={(q) =>
                  searchMccUnitsAction(q, pickedMccIds).then((rows) => {
                    setMccLabels((prev) => {
                      const m = new Map(prev);
                      for (const x of rows) m.set(x.id, x);
                      return m;
                    });
                    return rows;
                  })
                }
                value={pickerValue}
                onChange={(id) =>
                  addMcc(
                    id,
                    id === '' ? undefined : mccLabels.get(id) ?? undefined,
                  )
                }
                placeholder={
                  pickedMccIds.length === 0
                    ? 'Search client codes…'
                    : 'Add another client code…'
                }
              />
              <p className="text-[11px] text-muted-foreground">
                {pickedMccIds.length === 0
                  ? 'Pick one or more client codes — the user will only see data for these centres.'
                  : `${pickedMccIds.length} client code${pickedMccIds.length === 1 ? '' : 's'} assigned.`}
              </p>
            </>
          )}
        </div>

        {state.error && (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {state.error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={pending}>
            {pending ? 'Creating…' : 'Create user'}
          </Button>
        </div>
      </form>
    </div>
  );
}
