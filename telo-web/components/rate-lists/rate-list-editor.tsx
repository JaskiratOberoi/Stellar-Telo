'use client';

import { useMemo, useState, useTransition } from 'react';
import { saveRate } from '@/actions/rateLists.actions';
import type { RateRow } from '@/db/read/rateLists';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function EditableRow({
  rateTypeId,
  row,
  canManage,
}: {
  rateTypeId: number;
  row: RateRow;
  canManage: boolean;
}) {
  const [val, setVal] = useState(row.price?.toString() ?? '');
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [pending, start] = useTransition();

  const dirty = (row.price?.toString() ?? '') !== val.trim();

  function onSave() {
    const p = Number(val);
    if (!Number.isInteger(p) || p < 0) {
      setStatus('error');
      return;
    }
    start(async () => {
      const r = await saveRate(rateTypeId, row.testMasterId, p);
      setStatus(r.ok ? 'saved' : 'error');
    });
  }

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{row.code}</TableCell>
      <TableCell>{row.name}</TableCell>
      <TableCell className="w-40 text-right">
        {canManage ? (
          <div className="flex items-center justify-end gap-2">
            <span className="text-muted-foreground">₹</span>
            <Input
              type="number"
              min={0}
              value={val}
              onChange={(e) => {
                setVal(e.target.value);
                setStatus('idle');
              }}
              className="h-8 w-24 text-right"
            />
            <Button
              size="sm"
              variant={dirty ? 'default' : 'outline'}
              disabled={pending || !dirty}
              onClick={onSave}
            >
              {pending ? '…' : status === 'saved' ? '✓' : 'Save'}
            </Button>
          </div>
        ) : (
          <span>{row.price != null ? `₹${row.price}` : '—'}</span>
        )}
      </TableCell>
      <TableCell className="w-20 text-xs text-muted-foreground">
        {status === 'error' ? (
          <span className="text-destructive">error</span>
        ) : status === 'saved' ? (
          <span className="text-green-600">saved</span>
        ) : row.price == null ? (
          'unset'
        ) : (
          ''
        )}
      </TableCell>
    </TableRow>
  );
}

export function RateListEditor({
  rateTypeId,
  rows,
  canManage,
}: {
  rateTypeId: number;
  rows: RateRow[];
  canManage: boolean;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    const base = n
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(n) ||
            r.code.toLowerCase().includes(n),
        )
      : rows;
    return base.slice(0, 100);
  }, [rows, q]);

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search tests by name or code…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />
      <p className="text-xs text-muted-foreground">
        {rows.length.toLocaleString('en-IN')} tests in this list
        {filtered.length === 100 ? ' · showing first 100, refine search' : ''}
        {canManage ? ' · edit a price and Save' : ''}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Code</TableHead>
            <TableHead>Test</TableHead>
            <TableHead className="w-40 text-right">Price</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                No tests match.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((r) => (
              <EditableRow
                key={r.testMasterId}
                rateTypeId={rateTypeId}
                row={r}
                canManage={canManage}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
