'use client';

import { useEffect, useState, useTransition } from 'react';
import { Download, FileText, Search, X } from 'lucide-react';
import {
  searchReports,
  type ReportSearchRow,
} from '@/actions/reporting.actions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fmtIST, todayIST } from '@/lib/datetime';
import { ReportPreview } from '@/components/reporting/report-preview';
import { REPORT_FILTERS, DEFAULT_FILTER_ID } from '@/lib/report/panels';

/** Split the LIS test-names CSV into clean individual test names. */
function splitTestNames(s: string | null): string[] {
  if (!s) return [];
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .split(',')
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const today = () => todayIST();

/** Hard cap on reports per bulk download. Keep in sync with MAX_ITEMS in
 *  app/api/reporting/pdf/bulk/route.ts. */
const MAX_BULK = 25;

export function ReportingView({ businessUnits }: { businessUnits: string[] }) {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [panel, setPanel] = useState(DEFAULT_FILTER_ID);
  const [clientCode, setClientCode] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [sid, setSid] = useState('');
  const [pid, setPid] = useState('');
  const [patientName, setPatientName] = useState('');

  const [rows, setRows] = useState<ReportSearchRow[] | null>(null);
  const [searchedPanel, setSearchedPanel] = useState(DEFAULT_FILTER_ID);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportSearchRow | null>(null);
  const [pending, startTransition] = useTransition();

  // ── Bulk selection + download ───────────────────────────────────────────
  const [selectedSids, setSelectedSids] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  function runSearch() {
    setError(null);
    setSelected(null);
    setSelectedSids(new Set());
    setBulkError(null);
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

  // Auto-load today's samples on first open, like the LIS worksheet.
  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only finalised reports are selectable for bulk download.
  const readyRows = (rows ?? []).filter((r) => r.ready);
  const selectedCount = selectedSids.size;

  function toggleOne(sid: string) {
    setBulkError(null);
    setSelectedSids((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  }

  function toggleAll() {
    setBulkError(null);
    setSelectedSids((prev) => {
      // If every ready row is already selected, clear; otherwise select all.
      const allSelected =
        readyRows.length > 0 && readyRows.every((r) => prev.has(r.sid));
      return allSelected ? new Set() : new Set(readyRows.map((r) => r.sid));
    });
  }

  async function downloadBulk() {
    const items = readyRows
      .filter((r) => selectedSids.has(r.sid))
      .map((r) => ({
        sid: r.sid,
        panel: searchedPanel,
        date: r.dateHint,
        patientName: r.patientName,
      }));
    if (items.length === 0) return;
    if (items.length > MAX_BULK) {
      setBulkError(`Select at most ${MAX_BULK} reports per download.`);
      return;
    }
    setBulkError(null);
    setDownloading(true);
    try {
      const res = await fetch('/api/reporting/pdf/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        throw new Error(`Could not generate PDF (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = `Reports_${items.length}_${stamp}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
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
        <Field label="Test filter">
          <select
            value={panel}
            onChange={(e) => setPanel(e.target.value)}
            className="flex h-9 w-full rounded-md border border-white/10 bg-input px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {REPORT_FILTERS.map((p) => (
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
      {pending && rows == null && (
        <p className="rounded-lg border border-white/10 p-6 text-center text-sm text-muted-foreground">
          Loading samples…
        </p>
      )}
      {rows != null && (
        <div className="rounded-lg border border-white/10">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No results found for these filters.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <SelectAllCheckbox
                      readyCount={readyRows.length}
                      selectedReadyCount={
                        readyRows.filter((r) => selectedSids.has(r.sid)).length
                      }
                      onToggle={toggleAll}
                    />
                  </TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>PID</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>SID</TableHead>
                  <TableHead>Test Names</TableHead>
                  <TableHead>Reported</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Report</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const tests = splitTestNames(r.testNames);
                  const checked = selectedSids.has(r.sid);
                  return (
                    <TableRow
                      key={r.sid}
                      className="align-top"
                      data-state={checked ? 'selected' : undefined}
                    >
                      <TableCell>
                        <Checkbox
                          className="mt-0.5"
                          checked={checked}
                          disabled={!r.ready}
                          onChange={() => toggleOne(r.sid)}
                          aria-label={
                            r.ready
                              ? `Select report for ${r.patientName ?? r.sid}`
                              : 'Report not finalised yet'
                          }
                          title={r.ready ? undefined : 'Report not finalised yet'}
                        />
                      </TableCell>
                      <TableCell className="text-xs">{r.clientCode ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.pid}</TableCell>
                      <TableCell className="font-medium">
                        {r.patientName ?? '—'}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {r.ageGender}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.sid}</TableCell>
                      <TableCell className="max-w-[26rem]">
                        {tests.length > 0 ? (
                          <ul className="space-y-0.5">
                            {tests.map((t, i) => (
                              <li key={i} className="text-xs leading-snug">
                                {t}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtIST(r.reportedAt)}</TableCell>
                      <TableCell className="text-xs">{r.status ?? '—'}</TableCell>
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
                  );
                })}
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

      {/* ── Bulk selection bar ──────────────────────────────────────────── */}
      {selectedCount > 0 && (
        <div className="sticky bottom-0 z-40 -mx-4 mt-2 border-t border-white/10 bg-card/80 px-4 py-3 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium">
                {selectedCount} report{selectedCount === 1 ? '' : 's'} selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedSids(new Set())}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> Clear
              </button>
              {bulkError && (
                <span className="text-xs text-destructive">{bulkError}</span>
              )}
              {selectedCount > MAX_BULK && !bulkError && (
                <span className="text-xs text-destructive">
                  Max {MAX_BULK} per download — narrow your selection.
                </span>
              )}
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={downloadBulk}
              disabled={downloading || selectedCount > MAX_BULK}
            >
              <Download className="h-3.5 w-3.5" />
              {downloading ? 'Preparing…' : 'Download merged PDF'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Header "select all" checkbox — ticks only finalised (ready) rows, with an
 *  indeterminate state when some but not all are selected. */
function SelectAllCheckbox({
  readyCount,
  selectedReadyCount,
  onToggle,
}: {
  readyCount: number;
  selectedReadyCount: number;
  onToggle: () => void;
}) {
  const allChecked = readyCount > 0 && selectedReadyCount === readyCount;
  const indeterminate = selectedReadyCount > 0 && selectedReadyCount < readyCount;
  return (
    <Checkbox
      checked={allChecked}
      indeterminate={indeterminate}
      disabled={readyCount === 0}
      onChange={onToggle}
      aria-label="Select all finalised reports"
      title={
        readyCount === 0 ? 'No finalised reports to select' : 'Select all finalised reports'
      }
    />
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
