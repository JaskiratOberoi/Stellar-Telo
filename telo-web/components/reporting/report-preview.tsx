'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
  onClose,
}: {
  sid: string;
  panel: string;
  date: string | null;
  patientName: string | null;
  onClose: () => void;
}) {
  const dateParam = date ? `&date=${encodeURIComponent(date)}` : '';
  // Split-by-department is the default layout (one department per page).
  const [split, setSplit] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        body: JSON.stringify({ sid, panel, date, patientName, split, exclude: excluded }),
      });
      if (!res.ok) {
        throw new Error(`Could not generate PDF (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Filename = patient name + SID (never the test name).
      const safeName =
        (patientName ?? '').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') ||
        'Report';
      a.download = `${safeName}_${sid}.pdf`;
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-white/10 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {patientName ?? 'Report'}{' '}
              <span className="font-mono text-xs text-muted-foreground">· {sid}</span>
            </p>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select
              value={split ? 'split' : 'continuous'}
              onChange={(e) => setSplit(e.target.value === 'split')}
              title="Report layout"
              className="h-9 rounded-md border border-white/10 bg-input px-2 text-xs text-foreground focus-visible:outline-none focus-visible:border-primary"
            >
              <option value="continuous">Continuous</option>
              <option value="split">Split by department</option>
            </select>
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
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close preview">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-neutral-200 p-3">
          <iframe
            title={`Report ${sid}`}
            src={`/print/reporting/${encodeURIComponent(sid)}?panel=${encodeURIComponent(panel)}${dateParam}${
              split ? '&split=1' : ''
            }`}
            className="h-[80vh] w-full rounded bg-white"
          />
        </div>
      </div>
    </div>
  );
}
