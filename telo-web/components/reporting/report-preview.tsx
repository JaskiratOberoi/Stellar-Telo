'use client';

import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Inline preview of a single TSH report. Loads the server-rendered fragment
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
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    setDownloading(true);
    try {
      const res = await fetch('/api/reporting/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid, panel, date }),
      });
      if (!res.ok) {
        throw new Error(`Could not generate PDF (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `TSH-${sid}.pdf`;
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
    <div className="rounded-lg border border-white/10 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {patientName ?? 'Report'}{' '}
            <span className="font-mono text-xs text-muted-foreground">· {sid}</span>
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" className="gap-1.5" onClick={download} disabled={downloading}>
            <Download className="h-3.5 w-3.5" />
            {downloading ? 'Preparing…' : 'Download PDF'}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close preview">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="bg-neutral-200 p-3">
        <iframe
          title={`Report ${sid}`}
          src={`/print/reporting/${encodeURIComponent(sid)}?panel=${encodeURIComponent(panel)}${dateParam}`}
          className="h-[1000px] w-full rounded bg-white"
        />
      </div>
    </div>
  );
}
