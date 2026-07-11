/**
 * Canonical download filename for a single sample report:
 *   `PatientName_SID_ProfileName.pdf`
 *
 * Used by every single-report download path so they stay identical:
 *  - the preview modal's Download button (components/reporting/report-preview.tsx),
 *  - a one-report bulk selection (components/reporting/reporting-view.tsx),
 *  - the server Content-Disposition on /api/reporting/pdf.
 *
 * Each segment is sanitised to filename-safe characters; empty segments are
 * dropped (so a report with no active profile filter is just
 * `PatientName_SID.pdf`, and a nameless patient falls back to `Report`).
 * The merged multi-report bulk download keeps its own `Reports_N_<date>.pdf`
 * name — one file can't carry several patients.
 */
function slug(part: string | null | undefined): string {
  return (part ?? '')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildReportFilename(args: {
  patientName: string | null | undefined;
  sid: string;
  profileName?: string | null;
}): string {
  const segments = [
    slug(args.patientName) || 'Report',
    slug(args.sid),
    slug(args.profileName),
  ].filter((s) => s.length > 0);
  return `${segments.join('_')}.pdf`;
}
