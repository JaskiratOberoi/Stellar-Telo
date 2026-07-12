'use client';

import { useEffect, useState, useTransition } from 'react';
import { Download, FileText, Lock, Search, X } from 'lucide-react';
import {
  searchReports,
  searchReportTests,
  type ReportSearchRow,
} from '@/actions/reporting.actions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RemoteCombobox } from '@/components/ui/remote-combobox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fmtListec, todayIST } from '@/lib/datetime';
import { ReportPreview } from '@/components/reporting/report-preview';
import { buildReportFilename } from '@/lib/report/reportFilename';

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

/** Shared <select> styling (matches the Input control). */
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-foreground/10 bg-input px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/60';

export function ReportingView({
  businessUnits,
  statuses,
  lockedClientCode = null,
}: {
  businessUnits: string[];
  statuses: string[];
  /** When set (client-facing roles), the report scope is fixed to this client
   *  code: the field is pre-filled and disabled, and the business-unit filter
   *  is locked to "All" so the user sees ALL of their own reports (they span
   *  BUs) and can't filter into an empty/foreign BU. Server-side scoping in
   *  reporting.actions.ts enforces this regardless of the UI. */
  lockedClientCode?: string | null;
}) {
  const locked = !!lockedClientCode;
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [clientCode, setClientCode] = useState(lockedClientCode ?? '');
  const [businessUnit, setBusinessUnit] = useState('');
  const [status, setStatus] = useState('');
  // Universal search box (patient, SID, PID, test name/code…).
  const [q, setQ] = useState('');
  // Test-filter picker: combobox is keyed by catalog id; `testCache` resolves
  // the picked id → its code/name (mirrors the mccLabels pattern elsewhere).
  const [testId, setTestId] = useState<number | ''>('');
  const [testCache, setTestCache] = useState<
    Map<number, { code: string; name: string | null }>
  >(() => new Map());

  const [rows, setRows] = useState<ReportSearchRow[] | null>(null);
  // The test code that produced the current rows — anchors the report value
  // column and is forwarded to the preview / PDF routes (the fragment ignores it).
  const [searchedTestCode, setSearchedTestCode] = useState('');
  // Friendly name of that same filter (the profile/test the search was run on).
  // Appended to single-report download filenames as the ProfileName segment.
  const [searchedTestName, setSearchedTestName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportSearchRow | null>(null);
  // Report the user tried to open while it's balance-locked → pop-up.
  const [lockedNotice, setLockedNotice] = useState<ReportSearchRow | null>(null);
  const [pending, startTransition] = useTransition();

  // ── Bulk selection + download ───────────────────────────────────────────
  const [selectedSids, setSelectedSids] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  // Staple each report's LIS graph attachment (Double/Quadruple Marker, allergy
  // panels, …) after its pages in the merged PDF. Reports without a graph are
  // unaffected. Defaults ON — that's the report the lab actually issues.
  const [includeGraphs, setIncludeGraphs] = useState(true);

  function runSearch() {
    setError(null);
    setSelected(null);
    setSelectedSids(new Set());
    setBulkError(null);
    const testCode = testId === '' ? '' : testCache.get(testId)?.code ?? '';
    const testName = testId === '' ? '' : testCache.get(testId)?.name ?? '';
    startTransition(async () => {
      try {
        const result = await searchReports({
          from,
          to,
          testCode,
          clientCode,
          businessUnit,
          status,
          q,
        });
        setSearchedTestCode(testCode);
        setSearchedTestName(testName);
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
  // Balance-locked reports can't be viewed/printed/bulk-downloaded.
  const readyRows = (rows ?? []).filter((r) => r.ready && !r.locked);
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
        panel: searchedTestCode,
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
        body: JSON.stringify({ items, withGraph: includeGraphs }),
      });
      if (!res.ok) {
        throw new Error(`Could not generate PDF (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // One selected report → name it after the patient like every other
      // single-report download. A true multi-report merge can't carry several
      // patients, so it keeps the batch name Reports_<count>_<date>.pdf.
      if (items.length === 1) {
        a.download = buildReportFilename({
          patientName: items[0].patientName,
          sid: items[0].sid,
          profileName: searchedTestName,
        });
      } else {
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.download = `Reports_${items.length}_${stamp}.pdf`;
      }
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
        className="grid grid-cols-1 gap-3 rounded-lg border border-foreground/10 bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
      >
        {/* From + To share one cell (each half-width). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="From">
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Test filter">
          <RemoteCombobox
            value={testId}
            onChange={(id) => setTestId(id)}
            search={async (query) => {
              const items = await searchReportTests(query);
              setTestCache((prev) => {
                const m = new Map(prev);
                for (const it of items) m.set(it.id, { code: it.code, name: it.name });
                return m;
              });
              return items;
            }}
            getSelectedLabel={(id) => {
              const it = testCache.get(id);
              return it ? `${it.name ?? it.code} (${it.code})` : undefined;
            }}
            placeholder="All tests — type to filter…"
          />
        </Field>
        <Field label="Search">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Patient, SID, PID, test name/code…"
          />
        </Field>
        <Field label="Client code">
          <Input
            value={clientCode}
            onChange={(e) => setClientCode(e.target.value)}
            placeholder="e.g. HLD0512"
            disabled={locked}
            readOnly={locked}
            title={locked ? 'Locked to your client account' : undefined}
            className={locked ? 'cursor-not-allowed opacity-70' : undefined}
          />
        </Field>
        <Field label="Business unit">
          <select
            value={businessUnit}
            onChange={(e) => setBusinessUnit(e.target.value)}
            className={`${SELECT_CLASS}${locked ? ' cursor-not-allowed opacity-70' : ''}`}
            disabled={locked}
            title={locked ? 'Showing all your business units' : undefined}
          >
            <option value="">All business units</option>
            {businessUnits.map((bu) => (
              <option key={bu} value={bu}>
                {bu}
              </option>
            ))}
          </select>
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
      {/* While a search runs the skeleton REPLACES the previous results — stale
          rows must not be scrollable/clickable mid-search (a click on an old row
          could open the wrong patient's report). */}
      {pending && <ResultsSkeleton />}
      {!pending && rows != null && (
        <div className="rounded-lg border border-foreground/10">
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
                          disabled={!r.ready || r.locked}
                          onChange={() => toggleOne(r.sid)}
                          aria-label={
                            r.locked
                              ? 'On hold — outstanding balance'
                              : r.ready
                                ? `Select report for ${r.patientName ?? r.sid}`
                                : 'Report not finalised yet'
                          }
                          title={
                            r.locked
                              ? 'On hold — outstanding balance'
                              : r.ready
                                ? undefined
                                : 'Report not finalised yet'
                          }
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
                      <TableCell className="max-w-[12rem] sm:max-w-[26rem]">
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
                      <TableCell className="whitespace-nowrap text-xs">{fmtListec(r.reportedAt)}</TableCell>
                      <TableCell className="text-xs">{r.status ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        {r.locked ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/5"
                            onClick={() => setLockedNotice(r)}
                          >
                            <Lock className="h-3.5 w-3.5" />
                            On hold
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setSelected(r)}
                          >
                            <FileText className="h-3.5 w-3.5" />
                            View
                          </Button>
                        )}
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
          panel={searchedTestCode}
          date={selected.dateHint}
          patientName={selected.patientName}
          profileName={searchedTestName || null}
          onClose={() => setSelected(null)}
        />
      )}

      {/* ── Balance-lock pop-up ─────────────────────────────────────────── */}
      {lockedNotice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setLockedNotice(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Lock className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">
                  Report on hold — balance due
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  This report can’t be viewed or printed in Telo because{' '}
                  {lockedNotice.patientName ?? 'this patient'} has an outstanding
                  balance of{' '}
                  <span className="font-semibold text-foreground">
                    ₹{lockedNotice.dueAmount.toLocaleString('en-IN')}
                  </span>{' '}
                  on their{' '}
                  {lockedNotice.lockReason === 'client'
                    ? 'client account'
                    : 'bill'}
                  . Please collect the pending amount to release the report.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Reports for patients with a pending balance are held across all
                  client codes. Once the balance is cleared, the report unlocks
                  automatically.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Button size="sm" onClick={() => setLockedNotice(null)}>
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk selection bar ──────────────────────────────────────────── */}
      {selectedCount > 0 && (
        <div className="sticky bottom-0 z-40 -mx-4 mt-2 border-t border-foreground/10 bg-card/80 px-4 py-3 backdrop-blur-sm">
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
            <div className="flex items-center gap-3">
              <label
                className={`flex select-none items-center gap-2 text-xs font-medium text-foreground ${
                  downloading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                }`}
                title={
                  downloading
                    ? 'Preparing the merged PDF — locked until it finishes.'
                    : "ON: each report's attached graph pages (e.g. Double/Quadruple Marker) follow its report inside the merged PDF, like the LIS printed report. Reports without a graph are unaffected."
                }
              >
                <span className="relative inline-flex h-4 w-7 shrink-0 items-center">
                  <input
                    type="checkbox"
                    checked={includeGraphs}
                    onChange={(e) => setIncludeGraphs(e.target.checked)}
                    disabled={downloading}
                    className="peer sr-only"
                  />
                  <span className="absolute inset-0 rounded-full bg-foreground/20 transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-card" />
                  <span className="absolute left-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-3" />
                </span>
                Include graphs
              </label>
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

/**
 * Shimmering placeholder for the results table, shown while a search runs. It
 * mirrors the real columns (select, client, PID, patient, SID, tests, reported,
 * status, report button) and carries a floating "Searching reports…" pill —
 * matching the report-preview loader — so it's obvious a fresh search is in
 * flight and the old rows are gone.
 */
function ResultsSkeleton() {
  const bar = 'rounded bg-foreground/10';
  const dim = 'rounded bg-foreground/[0.06]';
  // Deterministic per-row width variation so the shimmer reads as real data.
  const nameW = [72, 55, 64, 48, 68, 58];
  const testW = [80, 60, 72, 52, 66, 76];
  return (
    <div
      className="relative overflow-hidden rounded-lg border border-foreground/10"
      role="status"
      aria-busy="true"
      aria-label="Searching reports"
    >
      <div className="animate-pulse" aria-hidden>
        {/* Column header band */}
        <div className="flex items-center gap-4 border-b border-foreground/10 bg-foreground/[0.03] px-4 py-3.5">
          <div className={`h-4 w-4 ${dim}`} />
          <div className={`h-2 w-12 ${bar}`} />
          <div className={`h-2 w-8 ${bar}`} />
          <div className={`h-2 w-28 flex-1 ${bar} max-w-[9rem]`} />
          <div className={`h-2 w-10 ${bar}`} />
          <div className={`h-2 w-24 flex-1 ${bar} max-w-[8rem]`} />
          <div className={`hidden h-2 w-20 sm:block ${bar}`} />
          <div className={`hidden h-2 w-14 sm:block ${bar}`} />
          <div className={`h-2 w-14 ${bar}`} />
        </div>
        {/* Result rows */}
        {nameW.map((w, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-foreground/5 px-4 py-3.5 last:border-b-0"
          >
            <div className={`h-4 w-4 ${dim}`} />
            <div className={`h-2.5 w-12 ${bar}`} />
            <div className={`h-2.5 w-8 ${bar}`} />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className={`h-2.5 ${bar}`} style={{ width: `${w}%` }} />
              <div className={`h-2 w-24 ${dim}`} />
            </div>
            <div className={`h-2.5 w-10 ${bar}`} />
            <div className="hidden min-w-0 flex-1 space-y-1.5 sm:block">
              <div className={`h-2.5 ${bar}`} style={{ width: `${testW[i]}%` }} />
              {i % 2 === 0 && <div className={`h-2.5 ${dim}`} style={{ width: `${testW[i] * 0.6}%` }} />}
            </div>
            <div className={`hidden h-2.5 w-20 sm:block ${bar}`} />
            <div className={`hidden h-2.5 w-14 sm:block ${bar}`} />
            <div className={`h-8 w-[4.5rem] rounded-md ${dim}`} />
          </div>
        ))}
      </div>
      {/* Floating status pill */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex items-center gap-2.5 rounded-full border border-foreground/10 bg-card px-4 py-2 shadow-lg">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
          <span className="text-xs font-medium text-foreground">Searching reports…</span>
        </div>
      </div>
    </div>
  );
}
