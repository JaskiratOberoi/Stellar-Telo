'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, LineChart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildReportFilename } from '@/lib/report/reportFilename';

/**
 * Modal preview of a single sample report. Loads the server-rendered fragment
 * (`/print/reporting/[sid]`) into an iframe — the exact same render Chromium
 * turns into the PDF — and offers a Download button that POSTs to the PDF route
 * and saves the returned blob (the report on the Noble letterhead).
 */
export function ReportPreview({
  sid,
  panel,
  date,
  patientName,
  profileName,
  onClose,
}: {
  sid: string;
  panel: string;
  date: string | null;
  patientName: string | null;
  /** Friendly name of the active profile/test filter, appended to the download
   *  filename (PatientName_SID_ProfileName.pdf). Null when the search had no
   *  single-test filter. */
  profileName: string | null;
  onClose: () => void;
}) {
  const dateParam = date ? `&date=${encodeURIComponent(date)}` : '';
  // Split-by-department is the default layout (one department per page).
  const [split, setSplit] = useState(true);
  // Headless: drop the Noble letterhead (header + footer) from the PDF but keep
  // the same margins, so it can be printed onto physical pre-printed letterhead
  // paper. Default ON (headless) — the "Letterhead" toggle below is OFF by
  // default; turning it ON adds the Noble header + footer.
  const [headless, setHeadless] = useState(true);
  // The iframe URL is frozen at mount (seeded with the defaults above): flipping
  // Letterhead / layout must NOT reload the iframe — the fragment applies them
  // client-side on a `telo:report-display` postMessage, so the switch is
  // instant instead of a multi-second server re-render.
  const [previewSrc] = useState(
    () =>
      `/print/reporting/${encodeURIComponent(sid)}?panel=${encodeURIComponent(panel)}${dateParam}&split=1&headless=1`,
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // True until the report fragment finishes loading — drives the skeleton
  // overlay below (only the initial load; display toggles don't reload).
  const [previewLoading, setPreviewLoading] = useState(true);

  // Push the current display options into the loaded fragment. Runs on every
  // toggle and again on iframe load (covering toggles made while loading).
  useEffect(() => {
    if (previewLoading) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'telo:report-display', sid, split, headless },
      window.location.origin,
    );
  }, [previewLoading, split, headless, sid]);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Graph attachment (LIS): some tests (Double/Quadruple Marker, allergy panels)
  // have a graph PDF stapled to the report in the LIS. We expose it as a separate
  // download. `graphCount` (0 => no button) comes from a cheap meta probe.
  const [graphCount, setGraphCount] = useState(0);
  const [graphBusy, setGraphBusy] = useState(false);
  // True while the graph-attachment probe is in flight. Drives a placeholder in
  // the toolbar so the download controls don't visibly jump when the probe
  // resolves and (maybe) reveals the "+ Graph" toggle + Graph button.
  const [graphProbing, setGraphProbing] = useState(true);
  // Staple the graph pages after the report in the downloaded PDF (one merged
  // document, like the LIS printed report). Only offered when the SID has a
  // graph attachment; defaults ON — that's the report the lab actually issues.
  const [includeGraph, setIncludeGraph] = useState(true);
  // Item keys the user unticked in the preview iframe (reported via postMessage).
  // These tests are omitted from the generated PDF. `report` carries the test
  // counts so we can block a download with nothing ticked. `remaining` already
  // accounts for profile-level unticks cascading to their children.
  const [excluded, setExcluded] = useState<string[]>([]);
  const [report, setReport] = useState<{ total: number; remaining: number }>({
    total: 0,
    remaining: 0,
  });
  const nothingSelected = report.total > 0 && report.remaining === 0;

  // Render via a portal to <body> so the modal escapes the page's <main
  // class="relative z-10"> stacking context — otherwise the sticky navbar
  // (z-40) paints over the modal even though the modal is z-50, because main's
  // z-10 caps everything inside it below the navbar. Mounted-gate for SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Close on Escape; lock background scroll while the modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Track which tests are ticked in the preview. The report fragment posts its
  // selection on load and on every toggle; a fresh iframe (e.g. on layout
  // change) re-announces, so this stays in sync.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (
        d &&
        d.type === 'telo:report-selection' &&
        d.sid === sid &&
        Array.isArray(d.excluded)
      ) {
        setExcluded(d.excluded.filter((k: unknown): k is string => typeof k === 'string'));
        if (typeof d.total === 'number' && typeof d.remaining === 'number') {
          setReport({ total: d.total, remaining: d.remaining });
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sid]);

  // Probe whether this SID has a graph attachment (cheap, no bytes) so we only
  // show the button when there's something to download.
  useEffect(() => {
    let alive = true;
    setGraphCount(0);
    setGraphProbing(true);
    fetch(`/api/reporting/graph/${encodeURIComponent(sid)}?meta=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.count === 'number') setGraphCount(d.count);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setGraphProbing(false);
      });
    return () => {
      alive = false;
    };
  }, [sid]);

  async function downloadGraph() {
    setError(null);
    setGraphBusy(true);
    try {
      const res = await fetch(`/api/reporting/graph/${encodeURIComponent(sid)}`);
      if (res.status === 423) {
        throw new Error('Reports are on hold while a balance is outstanding.');
      }
      if (res.status === 404) {
        setGraphCount(0);
        throw new Error('No graph is attached to this report.');
      }
      if (!res.ok) {
        throw new Error(`Could not download the graph (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const ext =
        blob.type === 'image/png' ? 'png' : blob.type.startsWith('image/') ? 'jpg' : 'pdf';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // PatientName_SID_graph.<ext> — mirrors the report's own filename scheme.
      const base = buildReportFilename({ patientName, sid, profileName }).replace(/\.pdf$/i, '');
      a.download = `${base}_graph.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Graph download failed.');
    } finally {
      setGraphBusy(false);
    }
  }

  async function download() {
    if (nothingSelected) {
      setError('Tick at least one test to include in the PDF.');
      return;
    }
    setError(null);
    setDownloading(true);
    try {
      const res = await fetch('/api/reporting/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sid,
          panel,
          date,
          patientName,
          profileName,
          split,
          headless,
          exclude: excluded,
          withGraph: graphCount > 0 && includeGraph,
        }),
      });
      if (!res.ok) {
        throw new Error(`Could not generate PDF (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Filename = PatientName_SID_ProfileName (a.download overrides the
      // server's Content-Disposition for blob saves — keep them in sync).
      a.download = buildReportFilename({ patientName, sid, profileName });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-foreground/10 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-foreground/10 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {patientName ?? 'Report'}{' '}
              <span className="font-mono text-xs text-muted-foreground">· {sid}</span>
            </p>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label
              className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-md border border-foreground/10 bg-input px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5"
              title="ON: include the Noble letterhead (header + footer). OFF (default): headless — same spacing/margins with no header/footer, for printing onto pre-printed letterhead paper."
            >
              <span className="relative inline-flex h-4 w-7 shrink-0 items-center">
                <input
                  type="checkbox"
                  checked={!headless}
                  onChange={(e) => setHeadless(!e.target.checked)}
                  className="peer sr-only"
                />
                <span className="absolute inset-0 rounded-full bg-foreground/20 transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-input" />
                <span className="absolute left-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-3" />
              </span>
              Letterhead
            </label>
            <select
              value={split ? 'split' : 'continuous'}
              onChange={(e) => setSplit(e.target.value === 'split')}
              title="Report layout"
              className="h-9 rounded-md border border-foreground/10 bg-input px-2 text-xs text-foreground focus-visible:outline-none focus-visible:border-primary"
            >
              <option value="continuous">Continuous</option>
              <option value="split">Split by department</option>
            </select>
            {/* Graph button: real once probed & present; a skeleton while the
                attachment probe is in flight so the toolbar doesn't jump. */}
            {graphProbing ? (
              <div
                className="h-8 w-[4.75rem] shrink-0 animate-pulse rounded-md border border-foreground/10 bg-foreground/5"
                aria-hidden
              />
            ) : (
              graphCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={downloadGraph}
                  disabled={graphBusy}
                  title="Download the graph attached to this report (e.g. Double/Quadruple Marker)"
                >
                  <LineChart className="h-3.5 w-3.5" />
                  {graphBusy
                    ? 'Preparing…'
                    : graphCount > 1
                      ? `Graph (${graphCount})`
                      : 'Graph'}
                </Button>
              )
            )}
            {graphProbing ? (
              // Probing: render the split-shaped Download with a spinner where the
              // "+ Graph" switch will land, so when the probe resolves for a graph
              // report the control is already in place and nothing pops in. The
              // Download half stays fully usable throughout.
              <div className="inline-flex h-8 shrink-0 items-center overflow-hidden rounded-md bg-primary text-primary-foreground shadow">
                <span className="flex h-full select-none items-center gap-1.5 pl-2.5 pr-2 text-xs font-medium opacity-90">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                  + Graph
                </span>
                <span className="h-4 w-px shrink-0 bg-primary-foreground/25" aria-hidden />
                <button
                  type="button"
                  onClick={download}
                  disabled={downloading || nothingSelected}
                  title={nothingSelected ? 'Tick at least one test to download' : undefined}
                  className="flex h-full items-center gap-1.5 pl-2.5 pr-3 text-xs font-medium transition-colors hover:bg-black/10 disabled:pointer-events-none disabled:opacity-60"
                >
                  <Download className="h-3.5 w-3.5" />
                  {downloading ? 'Preparing…' : 'Download PDF'}
                </button>
              </div>
            ) : graphCount > 0 ? (
              // Split control: the "+ Graph" toggle lives INSIDE the Download
              // button so it reads as "what this download includes". Left segment
              // toggles whether the graph is stapled into the PDF; right segment
              // triggers the download.
              <div className="inline-flex h-8 shrink-0 items-center overflow-hidden rounded-md bg-primary text-primary-foreground shadow">
                <label
                  className={`flex h-full select-none items-center gap-1.5 pl-2.5 pr-2 text-xs font-medium transition-colors ${
                    downloading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-black/10'
                  }`}
                  title={
                    downloading
                      ? 'Preparing the PDF — locked until it finishes.'
                      : 'ON: append the attached graph pages after the report so the download is ONE merged file (report + graph), like the LIS printed report. OFF: download the report alone — the Graph button still saves the graph separately.'
                  }
                >
                  <span className="relative inline-flex h-3.5 w-6 shrink-0 items-center">
                    <input
                      type="checkbox"
                      checked={includeGraph}
                      onChange={(e) => setIncludeGraph(e.target.checked)}
                      disabled={downloading}
                      className="peer sr-only"
                    />
                    <span className="absolute inset-0 rounded-full bg-primary-foreground/30 transition-colors peer-checked:bg-primary-foreground" />
                    <span className="absolute left-0.5 h-2.5 w-2.5 rounded-full bg-primary-foreground shadow-sm transition-all peer-checked:translate-x-[0.625rem] peer-checked:bg-primary" />
                  </span>
                  + Graph
                </label>
                <span className="h-4 w-px shrink-0 bg-primary-foreground/25" aria-hidden />
                <button
                  type="button"
                  onClick={download}
                  disabled={downloading || nothingSelected}
                  title={nothingSelected ? 'Tick at least one test to download' : undefined}
                  className="flex h-full items-center gap-1.5 pl-2.5 pr-3 text-xs font-medium transition-colors hover:bg-black/10 disabled:pointer-events-none disabled:opacity-60"
                >
                  <Download className="h-3.5 w-3.5" />
                  {downloading ? 'Preparing…' : 'Download PDF'}
                </button>
              </div>
            ) : (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={download}
                disabled={downloading || nothingSelected}
                title={nothingSelected ? 'Tick at least one test to download' : undefined}
              >
                <Download className="h-3.5 w-3.5" />
                {downloading ? 'Preparing…' : 'Download PDF'}
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close preview">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-auto bg-neutral-200 p-3">
          {previewLoading && <ReportSkeleton />}
          <iframe
            ref={iframeRef}
            title={`Report ${sid}`}
            src={previewSrc}
            onLoad={() => setPreviewLoading(false)}
            className={`h-[80vh] w-full rounded bg-white transition-opacity duration-300 ${
              previewLoading ? 'opacity-0' : 'opacity-100'
            }`}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Loading state for the preview iframe: a shimmering mock of the report page
 * (letterhead band, patient-meta grid, result table rows, signature footer)
 * with a floating "Preparing report…" pill, shown until the server-rendered
 * fragment finishes loading. Display toggles never re-trigger it — they apply
 * client-side inside the loaded fragment.
 */
function ReportSkeleton() {
  const line = 'rounded bg-gray-200';
  return (
    <div className="absolute inset-3 z-10 flex items-start justify-center overflow-hidden rounded bg-white">
      <div className="w-full max-w-[680px] animate-pulse px-10 pt-10" aria-hidden>
        {/* Letterhead band */}
        <div className="mb-5 flex items-center gap-4 border-b-2 border-gray-100 pb-4">
          <div className="h-12 w-12 rounded-full bg-gray-200" />
          <div className="space-y-2">
            <div className={`h-3.5 w-44 ${line}`} />
            <div className={`h-2.5 w-64 bg-gray-100 rounded`} />
          </div>
        </div>
        {/* Patient meta grid */}
        <div className="mb-5 grid grid-cols-2 gap-x-12 gap-y-2.5">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className={`h-2.5 w-20 bg-gray-100 rounded`} />
              <div className={`h-2.5 ${line}`} style={{ width: `${[62, 40, 52, 34, 46, 58, 38, 50][i]}%` }} />
            </div>
          ))}
        </div>
        {/* Department band + column headers */}
        <div className="mb-2 h-5 w-full rounded bg-gray-100" />
        <div className="mb-3 flex gap-4">
          <div className={`h-2.5 w-2/5 ${line}`} />
          <div className={`h-2.5 w-1/6 ${line}`} />
          <div className={`h-2.5 w-1/6 ${line}`} />
          <div className={`h-2.5 w-1/4 ${line}`} />
        </div>
        {/* Result rows */}
        <div className="space-y-2.5">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-2.5 rounded bg-gray-100" style={{ width: `${[38, 30, 34, 26, 36, 28, 32, 24, 35][i]}%` }} />
              <div className="h-2.5 w-12 rounded bg-gray-100" />
              <div className="h-2.5 w-16 rounded bg-gray-100" />
            </div>
          ))}
        </div>
        {/* Signature footer */}
        <div className="mt-8 flex justify-between">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-2">
              <div className={`h-2.5 w-24 ${line}`} />
              <div className="h-2 w-20 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
      {/* Floating status pill */}
      <div className="absolute inset-x-0 top-[38%] flex justify-center">
        <div className="flex items-center gap-2.5 rounded-full border border-foreground/10 bg-card px-4 py-2 shadow-lg">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
          <span className="text-xs font-medium text-foreground">Preparing report…</span>
        </div>
      </div>
    </div>
  );
}
