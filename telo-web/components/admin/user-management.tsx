'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  createUserAction,
  setRoleAction,
  resetPasswordAction,
  setActiveAction,
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
import { fmtIST } from '@/lib/datetime';

const initial: AdminFormState = { error: null, ok: false };
const sel =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm';

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
  const [activeFilter, setActiveFilter] = useState<
    'active' | 'inactive' | 'all'
  >('active');
  const [createOpen, setCreateOpen] = useState(false);

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  // Reset to page 1 whenever any filter changes.
  useEffect(() => {
    setPage(1);
  }, [q, roleFilter, activeFilter]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return overview.users.filter((u) => {
      if (activeFilter === 'active' && !u.isActive) return false;
      if (activeFilter === 'inactive' && u.isActive) return false;
      if (roleFilter === 'unassigned' && u.teloRole != null) return false;
      if (
        roleFilter !== 'all' &&
        roleFilter !== 'unassigned' &&
        u.teloRole !== roleFilter
      )
        return false;
      if (!needle) return true;
      return (
        u.username.toLowerCase().includes(needle) ||
        (u.firstName ?? '').toLowerCase().includes(needle) ||
        (u.lastName ?? '').toLowerCase().includes(needle) ||
        (u.email ?? '').toLowerCase().includes(needle) ||
        (u.teloRole ?? '').toLowerCase().includes(needle)
      );
    });
  }, [overview.users, q, roleFilter, activeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  if (!mounted) {
    return <div className="h-96 animate-pulse rounded-xl border bg-muted/40" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5">
            <Label className="text-xs text-muted-foreground">Search</Label>
            <Input
              placeholder="Username, name, email, role…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 w-72"
              suppressHydrationWarning
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-xs text-muted-foreground">Telo role</Label>
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
            <Label className="text-xs text-muted-foreground">Status</Label>
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
            <TableHead className="w-44">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
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
  const [openRow, setOpenRow] = useState<null | 'role' | 'password'>(null);

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
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
              {labelFor(user.teloRole)}
            </span>
          ) : (
            <span className="text-xs italic text-muted-foreground">
              (bootstrap)
            </span>
          )}
        </TableCell>
        <TableCell className="text-center">
          {user.isActive ? (
            <span className="text-xs text-green-700">Yes</span>
          ) : (
            <span className="text-xs text-destructive">No</span>
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1.5 text-xs">
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
              active={!user.isActive}
              disabled={isSelf}
            />
          </div>
        </TableCell>
      </TableRow>
      {openRow === 'role' && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30">
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
          <TableCell colSpan={6} className="bg-muted/30">
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
          minLength={4}
          maxLength={50}
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

function CreateUserPanel({
  lisUsertypes,
  onClose,
}: {
  lisUsertypes: AdminOverview['lisUsertypes'];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(createUserAction, initial);

  useEffect(() => {
    if (state.ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  // Default LIS usertype: CLIENT REPORTING (8) when present, else first.
  const defaultLisId =
    lisUsertypes.find((t) => t.id === 8)?.id ?? lisUsertypes[0]?.id ?? '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <form
        action={action}
        className="w-full max-w-md space-y-2.5 rounded-xl border bg-background p-4 shadow-lg"
      >
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
              minLength={4}
              maxLength={50}
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
            <select name="teloRole" defaultValue="viewer" className={sel}>
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
