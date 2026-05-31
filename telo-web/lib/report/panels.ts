/**
 * Report panels — the named test/profile a user can report on. No IO, so this
 * is safe to import from both the client filter dropdown and server code.
 *
 * `codes` are the analyte test codes rendered (in order) as result rows.
 * `anchorCode` is the code the worksheet feed is filtered by to find candidate
 * samples (the analyte guaranteed present). `interpretationCode` is the test
 * whose Interpretation paragraph is shown for the panel.
 */
export interface ReportPanel {
  id: string;
  label: string;
  codes: string[];
  anchorCode: string;
  interpretationCode: string;
}

export const REPORT_PANELS: ReportPanel[] = [
  {
    id: 'thyroid-profile-1',
    label: 'Thyroid Profile I',
    codes: ['BI214', 'BI215', 'BI221'], // T3, T4, TSH
    anchorCode: 'BI221',
    interpretationCode: 'BI221',
  },
  {
    id: 'tsh',
    label: 'TSH (BI221)',
    codes: ['BI221'],
    anchorCode: 'BI221',
    interpretationCode: 'BI221',
  },
];

export const DEFAULT_PANEL_ID = 'thyroid-profile-1';

export function getPanel(id: string | null | undefined): ReportPanel {
  return (
    REPORT_PANELS.find((p) => p.id === id) ??
    REPORT_PANELS.find((p) => p.id === DEFAULT_PANEL_ID) ??
    REPORT_PANELS[0]
  );
}
