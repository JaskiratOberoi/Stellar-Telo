'use client';

import { useState, useTransition } from 'react';
import { FileText, Search } from 'lucide-react';
import {
  searchReports,
  type ReportSearchRow,
} from '@/actions/reporting.actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fmtIST } from '@/lib/datetime';
import { ReportPreview } from '@/components/reporting/report-preview';
import { REPORT_PANELS, DEFAULT_PANEL_ID } from '@/lib/report/panels';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

export function ReportingView({ businessUnits }: { businessUnits: string[] }) {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [panel, setPanel] = useState(DEFAULT_PANEL_ID);
  const [clientCode, setClientCode] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [sid, setSid] = useState('');
  const [pid, setPid] = useState('');
  const [patientName, setPatientName] = useState('');

  const [rows, setRows] = useState<ReportSearchRow[] | null>(null);
  const [searchedPanel, setSearchedPanel] = useState(DEFAULT_PANEL_ID);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportSearchRow | null>(null);
  const [pending, startTransition] = useTransition();

  function runSearch() {
    setError(null);
    setSelected(null);
    startTransition(async () => {
      try {
        const result = await searchReports({
          from,
          to,
          panel,
          clientCode,
          businessUnit,
          sid,
          pid,
          patientName,
        });
        setSearchedPanel(panel);
        setRows(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed.');
        setRows(null);
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <form
        className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
      >
        <Field label="From">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Report">
          <select
            value={panel}
            onChange={(e) => setPanel(e.target.value)}
            className="flex h-9 w-full rounded-md border border-white/10 bg-input px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {REPORT_PANELS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Client code">
          <Input
            value={clientCode}
            onChange={(e) => setClientCode(e.target.value)}
            placeholder="e.g. HLD0512"
          />
        </Field>
        <Field label="Business unit">
          <Input
            list="reporting-bu-list"
            value={businessUnit}
            onChange={(e) => setBusinessUnit(e.target.value)}
            placeholder="All"
          />
          <datalist id="reporting-bu-list">
            {businessUnits.map((bu) => (
              <option key={bu} value={bu} />
            ))}
          </datalist>
        </Field>
        <Field label="SID">
          <Input value={sid} onChange={(e) => setSid(e.target.value)} placeholder="Sample ID" />
        </Field>
        <Field label="PID">
          <Input
            value={pid}
            onChange={(e) => setPid(e.target.value)}
            inputMode="numeric"
            placeholder="Patient ID"
          />
        </Field>
        <Field label="Patient name">
          <Input
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="Partial match"
          />
        </Field>
        <div className="flex items-end sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={pending} className="gap-1.5">
            <Search className="h-4 w-4" />
            {pending ? 'Searching…' : 'Search'}
          </Button>
        </div>
      </form>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {rows != null && (
        <div className="rounded-lg border border-white/10">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No TSH results found for these filters.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>PID</TableHead>
                  <TableHead>SID</TableHead>
                  <TableHead>Age / Gender</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>TSH</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reported</TableHead>
                  <TableHead className="text-right">Report</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.sid}>
                    <TableCell className="font-medium">{r.patientName ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{r.pid}</TableCell>
                    <TableCell className="font-mono text-xs">{r.sid}</TableCell>
                    <TableCell>{r.ageGender}</TableCell>
                    <TableCell>{r.clientCode ?? '—'}</TableCell>
                    <TableCell>
                      <span className={r.abnormal ? 'font-semibold text-red-500' : ''}>
                        {r.value ?? '—'}
                        {r.unit ? ` ${r.unit}` : ''}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{r.status ?? '—'}</TableCell>
                    <TableCell className="text-xs">{fmtIST(r.reportedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setSelected(r)}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* ── Preview ─────────────────────────────────────────────────────── */}
      {selected && (
        <ReportPreview
          sid={selected.sid}
          panel={searchedPanel}
          date={selected.dateHint}
          patientName={selected.patientName}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
