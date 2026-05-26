'use client';

import { useState, useActionState } from 'react';
import {
  saveInvoiceConfigAction,
  type InvoiceConfigState,
} from '@/actions/invoiceConfig.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface MccRow {
  mccId: number;
  mccCode: string;
  mccName: string | null;
  config: {
    labName: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  } | null;
}

const initial: InvoiceConfigState = { error: null, ok: false };

function ConfigForm({ row, onClose }: { row: MccRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(saveInvoiceConfigAction, initial);

  return (
    <form action={action} className="space-y-3 pt-2">
      <input type="hidden" name="mccId" value={row.mccId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`ln-${row.mccId}`}>Lab / clinic name</Label>
          <Input
            id={`ln-${row.mccId}`}
            name="labName"
            placeholder={row.mccName ?? 'Display name on invoice'}
            defaultValue={row.config?.labName ?? ''}
          />
          <p className="text-xs text-muted-foreground">
            Overrides &ldquo;{row.mccName ?? row.mccCode}&rdquo; on the invoice header.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`ph-${row.mccId}`}>Phone</Label>
          <Input
            id={`ph-${row.mccId}`}
            name="phone"
            placeholder="+91 98765 43210"
            defaultValue={row.config?.phone ?? ''}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`ad-${row.mccId}`}>Address</Label>
          <Input
            id={`ad-${row.mccId}`}
            name="address"
            placeholder="123 Main Street, City — 110001"
            defaultValue={row.config?.address ?? ''}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`em-${row.mccId}`}>Email</Label>
          <Input
            id={`em-${row.mccId}`}
            name="email"
            type="email"
            placeholder="lab@example.com"
            defaultValue={row.config?.email ?? ''}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {state.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
        {state.ok && (
          <p className="text-sm text-secondary">Saved.</p>
        )}
      </div>
    </form>
  );
}

export function InvoiceConfigManager({
  rows,
  tableReady = true,
}: {
  rows: MccRow[];
  tableReady?: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No client accounts in scope. Run the SQL migration (06_table_telo_mcc_invoice_config.sql) first if the table is missing.
      </p>
    );
  }

  return (
    <div className="divide-y divide-white/5">
      {rows.map((row) => {
        const isOpen = editing === row.mccId;
        const hasConfig = !!(row.config?.labName || row.config?.address || row.config?.phone || row.config?.email);
        return (
          <div key={row.mccId} className={cn('py-3 px-1', isOpen && 'bg-white/[0.02] rounded-lg px-3')}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-sm">
                  {row.config?.labName ?? row.mccName ?? '—'}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  {row.mccCode} · ID {row.mccId}
                </p>
                {hasConfig && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {[row.config?.phone, row.config?.email].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(isOpen ? null : row.mccId)}
              >
                {isOpen ? 'Close' : hasConfig ? 'Edit' : 'Set up'}
              </Button>
            </div>
            {isOpen && (
              <ConfigForm row={row} onClose={() => setEditing(null)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
