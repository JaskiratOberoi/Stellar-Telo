'use client';

import { useCallback, useState, useTransition } from 'react';
import { getAuditTrail } from '@/actions/audit.actions';
import type { AuditPage, AuditRow } from '@/db/read/auditLog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtIST } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Audit trail viewer — filterable feed over dbo.telo_audit_log.
 *
 * Filters mirror (and extend) the LIS Audit_Trail.aspx screen: date range and
 * actor like the LIS, plus a structured CATEGORY dropdown in place of its
 * free-text "Function" match, and a search box that still covers the raw
 * kind/details (so a SID or bill number finds its events, same as the LIS's
 * PID/VAILID boxes).
 */

const CATEGORIES = [
  { value: 'all', label: 'All activity' },
  { value: 'reports', label: 'Reports' },
  { value: 'users', label: 'Users & admin' },
  { value: 'auth', label: 'Sign-ins & sessions' },
  { value: 'orders', label: 'Orders & billing' },
  { value: 'payments', label: 'Payments & receipts' },
  { value: 'samples', label: 'Samples' },
] as const;

/** Category of a kind — mirrors CATEGORY_PREFIXES in db/read/auditLog.ts. */
function categoryOf(kind: string): string {
  if (kind.startsWith('report.')) return 'reports';
  if (kind.startsWith('admin.')) return 'users';
  if (kind.startsWith('login.') || kind.startsWith('session.')) return 'auth';
  if (
    kind.startsWith('order.') ||
    kind.startsWith('bill.') ||
    kind.startsWith('patient.')
  )
    return 'orders';
  if (
    kind.startsWith('payment.') ||
    kind.startsWith('receipt.') ||
    kind.startsWith('mcc.')
  )
    return 'payments';
  if (kind.startsWith('sample.')) return 'samples';
  return 'other';
}

const CATEGORY_PILL: Record<string, string> = {
  reports: 'bg-primary/10 text-primary',
  users: 'bg-violet-500/10 text-violet-500 dark:text-violet-400',
  auth: 'bg-foreground/10 text-muted-foreground',
  orders: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  payments: 'bg-secondary/10 text-secondary',
  samples: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  other: 'bg-foreground/10 text-muted-foreground',
};

/** Friendly one-line label per event kind (falls back to the raw kind). */
const KIND_LABEL: Record<string, string> = {
  'login.success': 'Signed in',
  'login.failure': 'Sign-in failed',
  'login.rate_limited': 'Sign-in rate-limited',
  'session.revoked': 'Session revoked',
  'order.placed': 'Order placed',
  'payment.recorded': 'Payment recorded',
  'payment.refunded': 'Payment refunded',
  'admin.user.create': 'User created',
  'admin.user.update': 'User scope updated',
  'admin.user.scope.partial': 'User scope partially applied',
  'admin.user.role': 'Role changed',
  'admin.user.password': 'Password reset',
  'admin.user.active': 'Account activated/deactivated',
  'admin.user.lis_access': 'LIS access changed',
  'admin.user.mrp_only': 'MRP-only flag changed',
  'admin.user.prepared_by': 'Prepared-by override changed',
  'admin.profile_interpretation.save': 'Profile interpretation saved',
  'patient.info.update': 'Patient info edited',
  'bill.discount.set': 'Bill discount set',
  'receipt.voided': 'Receipt voided',
  'receipt.amount.edited': 'Receipt amount edited',
  'bill.test.cancelled': 'Test cancelled',
  'bill.booking.cancelled': 'Booking cancelled',
  'bill.booking.cancel.blocked': 'Booking cancel blocked',
  'bill.tests.edited': 'Bill tests edited',
  'mcc.payment.recorded': 'Client payment recorded',
  'mcc.online_payment.initiated': 'Online payment started',
  'mcc.online_payment.result': 'Online payment result',
  'sample.accessioned': 'Samples registered to worksheet',
  'report.viewed': 'Report viewed',
  'report.pdf': 'Report PDF downloaded',
  'report.pdf_bulk': 'Bulk report PDFs downloaded',
  'report.smart_pdf': 'Smart Report downloaded',
};

/** Known detail keys → short display labels; ₹-prefix for money fields. */
const DETAIL_LABEL: Record<string, string> = {
  billId: 'bill',
  receiptId: 'receipt',
  sid: 'SID',
  sids: 'SIDs',
  mcc: 'MCC',
  target: 'user #',
  role: 'role',
  reason: 'reason',
  status: 'status',
  count: 'count',
  registered: 'registered',
  skipped: 'skipped',
  charged: 'charged',
  mccCount: 'centres',
  lisUsertypeId: 'LIS type',
  orderId: 'order',
  lineId: 'line',
  cancelled: 'cancelled',
  refunded: 'refunded',
  blocked: 'blocked',
  itemCount: 'items',
  customCount: 'custom',
  mode: 'mode',
  error: 'error',
};
const MONEY_KEYS = new Set([
  'total',
  'amount',
  'discount',
  'balance',
  'chargeTotal',
  'oldAmount',
  'newAmount',
  'dueAmount',
]);

function detailChips(row: AuditRow): { k: string; v: string }[] {
  if (!row.details) return [];
  try {
    const obj = JSON.parse(row.details) as Record<string, unknown>;
    return Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => ({
        k: DETAIL_LABEL[k] ?? k,
        v: MONEY_KEYS.has(k)
          ? `₹${Number(v).toLocaleString('en-IN')}`
          : String(v),
      }));
  } catch {
    return [{ k: 'details', v: row.details.slice(0, 120) }];
  }
}

const sel =
  'h-9 rounded-md border border-foreground/10 bg-input px-3 text-sm text-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/60';

export function AuditTrail({ initial }: { initial: AuditPage }) {
  const [data, setData] = useState<AuditPage>(initial);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('all');
  const [actor, setActor] = useState('');
  const [q, setQ] = useState('');
  const [busy, startLoad] = useTransition();

  const load = useCallback(
    (page: number) => {
      startLoad(async () => {
        setData(
          await getAuditTrail({
            from: from || null,
            to: to || null,
            category,
            actor: actor || null,
            q: q || null,
            page,
          }),
        );
      });
    },
    [from, to, category, actor, q],
  );

  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
  const first = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const last = Math.min(data.total, data.page * data.pageSize);

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-foreground/5 bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          load(1);
        }}
      >
        <div className="space-y-0.5">
          <Label htmlFor="audit-from" className="text-xs">From</Label>
          <Input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-36"
          />
        </div>
        <div className="space-y-0.5">
          <Label htmlFor="audit-to" className="text-xs">To</Label>
          <Input
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 w-36"
          />
        </div>
        <div className="space-y-0.5">
          <Label className="text-xs">Category</Label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={sel}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-0.5">
          <Label htmlFor="audit-actor" className="text-xs">User</Label>
          <Input
            id="audit-actor"
            placeholder="Username or name…"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className="h-9 w-44"
          />
        </div>
        <div className="min-w-40 flex-1 space-y-0.5">
          <Label htmlFor="audit-q" className="text-xs">Search</Label>
          <Input
            id="audit-q"
            placeholder="SID, bill #, role, action…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9"
          />
        </div>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Loading…' : 'Apply'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => load(data.page)}
        >
          Refresh
        </Button>
      </form>

      {/* Result meta + pager */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {data.total === 0
            ? 'No matching activity.'
            : `${first.toLocaleString('en-IN')}–${last.toLocaleString('en-IN')} of ${data.total.toLocaleString('en-IN')} events`}
        </span>
        <span className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || data.page <= 1}
            onClick={() => load(data.page - 1)}
          >
            ‹ Prev
          </Button>
          <span className="tabular-nums">
            {data.page} / {lastPage}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || data.page >= lastPage}
            onClick={() => load(data.page + 1)}
          >
            Next ›
          </Button>
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">Time (IST)</TableHead>
            <TableHead className="w-48">User</TableHead>
            <TableHead className="w-64">Action</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                No activity matches these filters.
              </TableCell>
            </TableRow>
          ) : (
            data.rows.map((r) => {
              const cat = categoryOf(r.kind);
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {fmtIST(r.at)}
                  </TableCell>
                  <TableCell>
                    <span className="block truncate text-sm">
                      {r.actorName ?? r.actorUsername ?? '—'}
                    </span>
                    {r.actorUsername && r.actorName && (
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {r.actorUsername}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                        CATEGORY_PILL[cat],
                      )}
                      title={r.kind}
                    >
                      <span className="truncate">
                        {KIND_LABEL[r.kind] ?? r.kind}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {detailChips(r).map(({ k, v }) => (
                        <span key={k} className="whitespace-nowrap">
                          <span className="opacity-60">{k}</span>{' '}
                          <span className="font-mono text-foreground/80">
                            {v.length > 60 ? `${v.slice(0, 60)}…` : v}
                          </span>
                        </span>
                      ))}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
