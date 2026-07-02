/**
 * LabReport — presentational full-sample lab report, styled to match the
 * Noble/Lal reference layout. One component, two consumers:
 *   - the on-screen preview iframe (`/print/reporting/[sid]`), and
 *   - the headless-Chromium PDF render (`?pdf=1`), merged onto the letterhead.
 *
 * Renders every test on the SID grouped by department → panel → child blocks,
 * with per-group interpretation, inline comments and age-appropriate ranges.
 *
 * Test selection: in preview mode every toggleable test carries a tick box (all
 * ticked by default). A profile panel (e.g. LIVER FUNCTION TEST) gets a parent
 * tick box that cascades to all its children; each child (a sub-group like
 * BILIRUBIN, or a standalone test like AST) keeps its own tick box too, and
 * every individual parameter row inside a group (e.g. Hemoglobin within the CBC
 * analyzer block) gets its own tick box as well — unticking a group cascades to
 * its parameters exactly like a profile cascades to its children.
 * Unticking dims the item and posts the excluded keys up to the preview modal,
 * which forwards them to the PDF route — so the saved file contains exactly the
 * ticked tests. In PDF mode the excluded keys arrive via `excludedKeys` and
 * those items are dropped from the render entirely.
 */
'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { fmtIST, fmtListec } from '@/lib/datetime';
import { STATIC_NOTES_BY_CODE } from '@/lib/report/panels';
import type {
  CultureReport,
  SampleReportBlock,
  SampleReportDepartment,
  SampleReportGroup,
  SampleReportItem,
  SampleReportPanel,
  SampleReportRow,
} from '@/db/read/sampleReport';

/** Static "Note" lines for the given test codes (deduped union), e.g. the TSH
 *  notes. Used to print a test/profile's notes at the end of ITS section. */
function notesForCodes(codes: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of codes) {
    const key = (c ?? '').trim().toUpperCase();
    if (!key) continue;
    for (const n of STATIC_NOTES_BY_CODE[key] ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}

/** Derive a heading + body from LIS interpretation text whose leading label
 *  (e.g. "CLINICAL SIGNIFICANCE :", "Note:", "Interpretation:-") becomes the
 *  block heading instead of being repeated inline. */
function splitInterp(s: string): { heading: string; body: string } {
  const m = /^\s*(clinical significance|clinical use|interpretation|note)\s*:?-?\s*/i.exec(s);
  const heading = m
    ? m[1].replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Interpretation';
  const body = (m ? s.slice(m[0].length) : s).trim();
  return { heading, body };
}

/** Normalise comparator shorthand the way the LIS prints it: ">="/"<=" become
 *  ≥/≤, and a bare "=" used before a number (an open upper band like
 *  "High = 240") becomes ≥ — single values like "13.5 - 17.5" are untouched. */
function normalizeComparators(line: string): string {
  const out = line
    .replace(/>\s*=/g, '≥')
    .replace(/<\s*=/g, '≤')
    .replace(/(^|[\s(])=(?=\s*-?\d)/g, '$1≥');
  // An open-ended top band stored without any comparator (e.g. "Very High 190",
  // following "High 160-189") means "≥ 190". Only fire on a severity-banded
  // label that ends in a bare number with no existing comparator or range dash,
  // so plain/gendered/age single values stay untouched.
  if (
    /\b(very high|high|low|borderline|critical|severe|undesirable)\b/i.test(out) &&
    !/[<>≥≤=]/.test(out) &&
    !/\d\s*[-–]\s*\d/.test(out)
  ) {
    return out.replace(/^(.*[A-Za-z])\s+(\d+(?:\.\d+)?)\s*$/, '$1 ≥ $2');
  }
  return out;
}

/** Split a colon-labelled run-on (e.g. "Desirable: > 60 Optimal: 40-59 …") into
 *  one "Label: value" per segment. Returns the line unchanged if not labelled. */
function splitColonSegments(line: string): string[] {
  if ((line.match(/:/g) ?? []).length < 2) return [line];
  const re = /([A-Za-z][A-Za-z /]*?)\s*:\s*(.*?)(?=\s+[A-Za-z][A-Za-z /]*?\s*:|$)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const v = m[2].trim();
    out.push(v ? `${m[1].trim()}: ${v}` : m[1].trim());
  }
  return out.length >= 2 ? out : [line];
}

/**
 * Format a biological-reference range, one band per line. The LIS stores most
 * banded ranges with line breaks already (e.g. "Desirable < 200\nBorderline
 * High 200 - 239\nHigh = 240"); we keep those, split any run-on band (a new
 * Title-case label right after a number) and colon-labelled run-ons, and
 * normalise comparators. A plain value ("0.35 - 5.50") is returned as-is.
 */
function formatRange(s: string | null): string {
  if (!s) return '—';
  const lines = s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .flatMap(splitColonSegments)
    // Break a run-on like "…200 - 239 High 240" before a Title-case band label
    // that follows a number.
    .flatMap((l) => l.replace(/(\d)\s+(?=[A-Z][a-z])/g, '$1\n').split('\n'))
    .map((l) => normalizeComparators(l.trim()))
    .filter(Boolean);
  return lines.length ? lines.join('\n') : s.trim();
}

export interface LabReportSigner {
  id: number;
  doctorName: string | null;
  designation: string | null;
  /** Inlined signature image (data-URI) so it renders without a separate
   *  authed request — needed for the public token softcopy. */
  signatureDataUrl?: string | null;
}

export interface LabReportData {
  pdf?: boolean;
  /** Letterhead-paper mode: the report will be printed onto physical pre-printed
   *  Noble letterhead, so the Noble letterhead band is left blank. Only affects
   *  the on-screen preview (the PDF route skips the letterhead background itself);
   *  here it swaps the recreated Noble header for a blank reserved zone so the
   *  preview matches the headless PDF. */
  headless?: boolean;
  /** Start each department on a new page (the LIS "split" layout). */
  splitByDepartment?: boolean;
  /** Item keys the user unticked — omitted from the PDF render. A top-level item
   *  is "deptIndex:itemIndex"; a panel child is "deptIndex:itemIndex:childIndex";
   *  an individual parameter row appends its row index to its group's key (so
   *  "di:ii:ri" under a top-level group, "di:ii:ci:ri" under a profile child).
   *  Excluding a panel/group key cascades to everything beneath it.
   *  Empty/undefined means "include every test" (the default). */
  excludedKeys?: string[];
  patientName: string | null;
  pid: number;
  sid: string;
  sex: string | null;
  age: number | null;
  ageUnit: string | null;
  clientCode: string | null;
  refDoctor: string | null;
  collectedAt: string | null;
  registeredAt: string | null;
  reportedAt: string | null;
  statusLabel: string | null;
  billNumber: string | null;
  clinicalHistory: string | null;
  /** Distinct specimen / sample types on this sample (e.g. "Serum"). */
  specimens?: string[];
  /** profile_id → Telo profile-level clinical-significance text. Shown once
   *  below the whole profile; individual constituent interpretations are
   *  suppressed inside a profile. */
  profileInterpretations?: Record<number, string>;
  /** The collection centre (where the sample was drawn) — shown as "Collected
   *  at" in the header with its address + contact details. */
  collectionCentre?: {
    code: string;
    name: string | null;
    address: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  departments: SampleReportDepartment[];
  processedAt: {
    name: string | null;
    address: string | null;
    city: string | null;
    phone: string | null;
  } | null;
  signers: LabReportSigner[];
  printedAt: string;
  /** Data-URI PNG of the QR that points to the public softcopy URL; shown
   *  centred in the signature footer on every page. */
  qrDataUrl?: string | null;
}

function genderLabel(sex: string | null): string {
  if (!sex) return '—';
  const s = sex.trim();
  if (/^m/i.test(s)) return 'Male';
  if (/^f/i.test(s)) return 'Female';
  return s;
}

function ageLabel(age: number | null, unit: string | null): string {
  if (age == null) return '—';
  return `${age} ${(unit ?? 'Year(s)').trim()}`;
}

/** Top-level item key for the tick boxes and the PDF filter. */
const topKey = (di: number, ii: number) => `${di}:${ii}`;
/** Panel-child key, nested under its panel's top-level key. */
const childKey = (di: number, ii: number, ci: number) => `${di}:${ii}:${ci}`;
/** Parameter-row key, nested under its group's key (top-level or panel child). */
const rowKey = (groupKey: string, ri: number) => `${groupKey}:${ri}`;

export function LabReport({ data }: { data: LabReportData }) {
  // Preview shows tick boxes and instant client-side dimming; the PDF render is
  // non-interactive and instead drops the excluded items outright.
  const interactive = !data.pdf;

  // Which items/children are unticked. Preview owns this set live; PDF mode is
  // seeded from the keys passed in by the route and never changes.
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(data.excludedKeys ?? []),
  );

  function toggle(key: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** A leaf test is off when its own key — or its panel's key — is excluded. */
  const leafOff = (key: string, panelKey?: string) =>
    excluded.has(key) || (panelKey != null && excluded.has(panelKey));

  // Count selectable leaves (individual parameter rows for groups, the test
  // itself otherwise) and how many survive the current selection, so the
  // preview modal can block a download with nothing ticked.
  let totalLeaves = 0;
  let remainingLeaves = 0;
  data.departments.forEach((dept, di) => {
    dept.items.forEach((item, ii) => {
      const key = topKey(di, ii);
      if (item.kind === 'panel' && item.panel) {
        item.panel.children.forEach((child, ci) => {
          const ckey = childKey(di, ii, ci);
          const childOff = leafOff(ckey, key);
          if (child.kind === 'group' && child.group) {
            child.group.rows.forEach((_, ri) => {
              totalLeaves += 1;
              if (!childOff && !excluded.has(rowKey(ckey, ri))) remainingLeaves += 1;
            });
          } else {
            totalLeaves += 1;
            if (!childOff) remainingLeaves += 1;
          }
        });
      } else if (item.kind === 'group' && item.group) {
        if (item.group.culture) {
          // A Culture & Sensitivity report is one selectable unit, not per-row.
          totalLeaves += 1;
          if (!excluded.has(key)) remainingLeaves += 1;
        } else {
          item.group.rows.forEach((_, ri) => {
            totalLeaves += 1;
            if (!excluded.has(key) && !excluded.has(rowKey(key, ri))) remainingLeaves += 1;
          });
        }
      } else {
        totalLeaves += 1;
        if (!excluded.has(key)) remainingLeaves += 1;
      }
    });
  });

  // Broadcast the current selection to the preview modal (the parent window) so
  // its "Download PDF" request omits the unticked tests. Fires on mount and on
  // every toggle; no-ops during the headless PDF render.
  useEffect(() => {
    if (!interactive) return;
    window.parent?.postMessage(
      {
        type: 'telo:report-selection',
        sid: data.sid,
        excluded: Array.from(excluded),
        total: totalLeaves,
        remaining: remainingLeaves,
      },
      window.location.origin,
    );
  }, [interactive, excluded, data.sid, totalLeaves, remainingLeaves]);

  // Build page sections: each profile (panel) is its own section/page; a
  // standalone test/group that carries its OWN interpretation or notes (e.g.
  // Vitamin D, Vitamin B12 — long clinical commentary) also gets its own
  // section/page; only "bare" standalones (T3, T4 …) coalesce into one run. In
  // split mode every section starts on a new page and shows the department band;
  // in continuous mode the band shows once per department and nothing breaks.
  //
  // Keeping a heavy-commentary test alone per page is also what avoids the
  // blank-page artifact: a section taller than one page fragments the flex/
  // mt-auto footer layout and can bump its whole table onto the next page.
  type SecEntry = { item: SampleReportItem; di: number; ii: number; key: string };
  type Section = { deptName: string; deptStart: boolean; entries: SecEntry[] };
  const entryHasOwnContent = (item: SampleReportItem): boolean => {
    if (item.kind === 'single') {
      return (
        !!item.interpretation ||
        !!item.interpretationImageDataUrl ||
        notesForCodes([item.row?.code]).length > 0
      );
    }
    if (item.kind === 'group' && item.group) {
      return (
        !!item.group.interpretation ||
        !!item.group.interpretationImageDataUrl ||
        notesForCodes(item.group.rows.map((r) => r.code)).length > 0
      );
    }
    return false;
  };
  const sections: Section[] = [];
  data.departments.forEach((dept, di) => {
    const entries: SecEntry[] = dept.items
      .map((item, ii) => ({ item, di, ii, key: topKey(di, ii) }))
      .filter(({ item, ii, key }) => {
        if (interactive) return true;
        if (excluded.has(key)) return false;
        if (item.kind === 'panel' && item.panel) {
          return item.panel.children.some((child, ci) => {
            const ckey = childKey(di, ii, ci);
            if (excluded.has(ckey)) return false;
            if (child.kind === 'group' && child.group) {
              return child.group.rows.some((_, ri) => !excluded.has(rowKey(ckey, ri)));
            }
            return true;
          });
        }
        if (item.kind === 'group' && item.group) {
          if (item.group.culture) return !excluded.has(key);
          return item.group.rows.some((_, ri) => !excluded.has(rowKey(key, ri)));
        }
        return true;
      });
    if (entries.length === 0) return;
    let firstInDept = true;
    let run: Section | null = null;
    for (const entry of entries) {
      if (entry.item.kind === 'panel' || entryHasOwnContent(entry.item)) {
        // A profile, or a standalone test/group with its own commentary, takes a
        // dedicated section (own page in split mode).
        sections.push({ deptName: dept.name, deptStart: firstInDept, entries: [entry] });
        run = null;
      } else {
        if (!run) {
          run = { deptName: dept.name, deptStart: firstInDept, entries: [] };
          sections.push(run);
        }
        run.entries.push(entry);
      }
      firstInDept = false;
    }
  });

  const renderTopItem = ({ item, di, ii, key }: SecEntry): ReactNode => {
    if (item.kind === 'panel' && item.panel) {
      return (
        <PanelBlock
          key={key}
          panel={item.panel}
          panelKey={key}
          childKeyFor={(ci) => childKey(di, ii, ci)}
          interactive={interactive}
          excluded={excluded}
          onToggle={toggle}
          pdf={!!data.pdf}
          interpretation={
            item.panel.profileId != null
              ? (data.profileInterpretations?.[item.panel.profileId] ?? null)
              : null
          }
        />
      );
    }
    if (item.kind === 'group' && item.group) {
      return (
        <GroupBlock
          key={key}
          group={item.group}
          groupKey={key}
          interactive={interactive}
          excludedSet={excluded}
          groupOff={excluded.has(key)}
          onToggle={toggle}
          pdf={!!data.pdf}
        />
      );
    }
    if (item.row) {
      return (
        <SingleBlock
          key={key}
          row={item.row}
          interpretation={item.interpretation ?? null}
          interpretationImageDataUrl={item.interpretationImageDataUrl ?? null}
          interactive={interactive}
          excluded={excluded.has(key)}
          onToggle={() => toggle(key)}
        />
      );
    }
    return null;
  };

  const deptBandCls =
    'bg-gray-100 px-2 py-0.5 text-center text-[11px] font-bold uppercase tracking-wide text-[#2b2b6b]';
  const endMarker = (
    <tr>
      <td colSpan={5} className="pt-3 text-center text-[10px] font-semibold tracking-wide text-gray-600">
        *** End of Report ***
      </td>
    </tr>
  );

  // On screen (preview), split mode renders each section as a distinct page
  // "sheet" so the pagination is visible — screen media has no real pages, so
  // break-before:page / min-h are inert here. The PDF is a separate ?pdf=1
  // render and is unaffected by any of this preview chrome.
  const previewSheets = !data.pdf && data.splitByDepartment;

  // The signature/footer block can't be bottom-pinned from inside <tfoot>: a
  // table-footer-group repeats on every page but bottoms-out just under the last
  // row, so on a short/last page it floats up the page instead of sitting at the
  // bottom. Fix: keep the <tfoot> copy purely as an *invisible* spacer (it still
  // reserves the footer's exact height on every page, so flowing content never
  // runs under the footer), and render a second, *visible* copy that is pinned to
  // the page bottom — `position:fixed; bottom:0` for the PDF (Chromium paints a
  // fixed element at the content-box bottom of EVERY printed page; transforms /
  // negative offsets are NOT repositioned reliably per page, so we use a bare
  // bottom:0), and an absolutely-positioned per-sheet copy for the on-screen
  // split preview. Continuous preview keeps the footer visible in <tfoot>.
  const ghostFooter = data.pdf || previewSheets;
  const tfootFooter = (
    <tfoot>
      <tr>
        <td colSpan={5} className="p-0 align-bottom">
          <div className={ghostFooter ? 'invisible' : ''}>
            <ReportFooterBlock data={data} />
          </div>
        </td>
      </tr>
    </tfoot>
  );

  return (
    <div
      className={`mx-auto w-full max-w-[820px] text-black font-sans text-[11px] leading-snug ${
        data.pdf ? '' : previewSheets ? 'bg-gray-200 p-4' : 'bg-white p-8'
      }`}
    >
      {/* ── Recreated Noble letterhead (preview only). In split preview the logo
           is drawn atop each page sheet instead, so skip the once-at-top one.
           In letterhead-paper mode the band is left blank — the PDF prints onto
           pre-printed paper — so the preview reserves the space instead. */}
      {!data.pdf && !previewSheets &&
        (data.headless ? (
          <LetterheadZone className="mb-4 h-14 pb-3" />
        ) : (
          <div className="mb-4 flex items-center gap-4 border-b-2 border-[#2b2b6b] pb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/noble-logo.png" alt="Noble Diagnostic Centre" className="h-14 w-auto" />
          </div>
        ))}

      {sections.length === 0 ? (
        <p className="py-4 text-center text-gray-500">No results available for this sample.</p>
      ) : data.splitByDepartment ? (
        /* SPLIT: each section is a self-contained <table> — patient header in
           <thead> (repeats atop every page the section spans), results in
           <tbody>, and the signature/footer as an invisible <tfoot> spacer that
           reserves the footer's height on every page (so flowing rows never run
           under it). The visible footer is pinned to the page bottom separately:
           position:fixed for the PDF, an absolute per-sheet copy for this
           preview. Each profile gets its own page via break-before. */
        sections.map((sec, si) => {
          const sectionTable = (
            <table className="w-full table-fixed border-collapse">
              <ReportColgroup />
              <thead>
                <tr>
                  <td colSpan={5} className="p-0 align-top">
                    <PatientMetaBlock
                      data={data}
                      interactive={interactive}
                      totalLeaves={totalLeaves}
                    />
                  </td>
                </tr>
                <ColumnHeaderRow />
              </thead>
              {tfootFooter}
              <tbody>
                <tr>
                  <td colSpan={5} className={deptBandCls}>
                    {sec.deptName}
                  </td>
                </tr>
                {sec.entries.map((entry) => renderTopItem(entry))}
                {si === sections.length - 1 && endMarker}
              </tbody>
            </table>
          );
          // PDF: each section starts on a new page.
          if (!previewSheets) {
            return (
              <div key={si} className={si > 0 ? '[break-before:page]' : ''}>
                {sectionTable}
              </div>
            );
          }
          // PREVIEW: a distinct page "sheet" on a grey desk, with the letterhead
          // logo on top and a page-number badge, so each page is visible.
          return (
            <div
              key={si}
              className="relative mb-6 min-h-[270mm] w-full rounded-sm border border-gray-300 bg-white px-[10mm] py-[8mm] shadow-md"
            >
              <span className="pointer-events-none absolute right-2 top-2 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">
                Page {si + 1} of {sections.length}
              </span>
              {data.headless ? (
                <LetterheadZone className="mb-3 h-10 pb-2" />
              ) : (
                <div className="mb-3 flex items-center gap-3 border-b-2 border-[#2b2b6b] pb-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/branding/noble-logo.png" alt="Noble Diagnostic Centre" className="h-10 w-auto" />
                </div>
              )}
              {sectionTable}
              {/* The <tfoot> above is an invisible spacer; this visible copy is
                  pinned to the bottom of the sheet (matching the px/py inset). */}
              <div className="absolute inset-x-[10mm] bottom-[8mm]">
                <ReportFooterBlock data={data} />
              </div>
            </div>
          );
        })
      ) : (
        /* CONTINUOUS: one table — patient header + column headers repeat at the
           top of each page (thead), signature/footer at the end (tfoot), rows
           flow. Department band shows once per department. */
        <table className="w-full table-fixed border-collapse">
          <ReportColgroup />
          <thead>
            <tr>
              <td colSpan={5} className="p-0 align-top">
                <PatientMetaBlock data={data} interactive={interactive} totalLeaves={totalLeaves} />
              </td>
            </tr>
            <ColumnHeaderRow />
          </thead>
          {tfootFooter}
          <tbody>
            {sections.map((sec, si) => (
              <Fragment key={si}>
                {sec.deptStart && (
                  <tr>
                    <td colSpan={5} className={deptBandCls}>
                      {sec.deptName}
                    </td>
                  </tr>
                )}
                {sec.entries.map((entry) => renderTopItem(entry))}
              </Fragment>
            ))}
            {endMarker}
          </tbody>
        </table>
      )}

      {/* PDF: the single visible footer, pinned to the bottom of EVERY printed
          page. Chromium paints a position:fixed element once per page at the
          content-box bottom (= the @page bottom margin line, just above the
          letterhead's footer band); the <tfoot> ghost above reserves its height
          so flowing content never overlaps it. Full-bleed with a 14mm inset to
          match the @page side margins / report content width. */}
      {data.pdf && sections.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 px-[14mm]">
          <ReportFooterBlock data={data} />
        </div>
      )}
    </div>
  );
}

/** Blank stand-in for the Noble letterhead band in letterhead-paper (headless)
 *  preview mode. Reserves the same vertical space the logo header would take and
 *  marks it as the pre-printed-letterhead zone, so the preview mirrors the
 *  headless PDF (which leaves this band empty for physical letterhead paper). */
function LetterheadZone({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-sm border border-dashed border-gray-300 bg-gray-50/60 ${className}`}
      aria-hidden
    >
      <span className="text-[9px] uppercase tracking-wide text-gray-400">
        Pre-printed letterhead area
      </span>
    </div>
  );
}

/** Shared 5-column layout for the results table. */
function ReportColgroup() {
  return (
    <colgroup>
      <col className="w-[33%]" />
      <col className="w-[12%]" />
      <col className="w-[11%]" />
      <col className="w-[24%]" />
      <col className="w-[20%]" />
    </colgroup>
  );
}

/** The repeating column-header row. */
function ColumnHeaderRow() {
  return (
    <tr className="border-b border-gray-400 text-[12px]">
      <th className="py-0.5 pr-3 text-left font-semibold">Test Name</th>
      <th className="py-0.5 pr-3 text-left font-semibold">Value</th>
      <th className="py-0.5 pr-3 text-left font-semibold">Unit</th>
      <th className="py-0.5 pr-3 text-left font-semibold">Biological Ref Interval</th>
      <th className="py-0.5 text-left font-semibold">Method</th>
    </tr>
  );
}

/** Patient/sample demographics + "Collected at" + clinical history (+ the
 *  preview tick-box hint). Shown atop each page in split mode, once in
 *  continuous mode. */
function PatientMetaBlock({
  data,
  interactive,
  totalLeaves,
}: {
  data: LabReportData;
  interactive: boolean;
  totalLeaves: number;
}) {
  const cc = data.collectionCentre;
  const ccAddress = cc ? [cc.address, cc.city].filter(Boolean).join(', ') : '';
  return (
    <>
      {/* Demographics + "Collected at" + clinical history form one header block,
          closed by a single rule that marks the end of the pseudo-header. */}
      <div className="border-b border-gray-300 pb-1">
        <div className="grid grid-cols-2 gap-x-10 gap-y-0">
          <Meta label="Name" value={data.patientName ?? '—'} strong />
          <Meta label="Age / Gender" value={`${ageLabel(data.age, data.ageUnit)} / ${genderLabel(data.sex)}`} />
          <Meta label="SID" value={data.sid} mono strong />
          <Meta label="Patient Id" value={String(data.pid)} mono />
          <Meta label="Ref. Customer" value={data.clientCode ?? '—'} />
          <Meta label="Ref. Doctor" value={data.refDoctor ?? 'Self'} />
          {data.specimens && data.specimens.length > 0 && (
            <Meta label="Specimen" value={data.specimens.join(', ')} />
          )}
          <Meta label="Report Status" value={data.statusLabel ?? '—'} />
          {/* Collected/Registered/Reported come from the Listec worksheet feed
              (IST wall-clock reinterpreted as UTC) → fmtListec; Printed is a real
              Telo instant → fmtIST. See lib/datetime fmtListec. */}
          <Meta label="Collected" value={fmtListec(data.collectedAt)} />
          <Meta label="Registered" value={fmtListec(data.registeredAt)} />
          <Meta label="Reported" value={fmtListec(data.reportedAt)} />
          <Meta label="Printed" value={fmtIST(data.printedAt)} />
          {data.billNumber && <Meta label="Bill No." value={data.billNumber} mono />}
        </div>

        {cc && (
          <div className="mt-1.5 flex items-baseline gap-2 text-[10px] leading-snug text-gray-700">
            <span className="w-28 shrink-0 text-gray-500">Collected at</span>
            <span className="text-gray-400">:</span>
            <span>
              <span className="font-semibold">{cc.name ?? cc.code}</span>
              {ccAddress && <>, {ccAddress}</>}
              {(cc.email || cc.phone) && (
                <span className="text-gray-600">
                  {' — '}
                  {cc.email ? `Email: ${cc.email}` : ''}
                  {cc.email && cc.phone ? ' · ' : ''}
                  {cc.phone ? `Ph: ${cc.phone}` : ''}
                </span>
              )}
            </span>
          </div>
        )}

        {data.clinicalHistory && (
          <p className="mt-1 text-[11px] text-gray-600">
            <span className="font-semibold">Clinical history:</span> {data.clinicalHistory}
          </p>
        )}
      </div>

      {/* Tick-box hint (preview only). */}
      {interactive && totalLeaves > 0 && (
        <p className="mt-2 text-center text-[10px] italic text-gray-500 print:hidden">
          Tick the tests and parameters to include. Unticking a profile or test
          drops everything under it; unticked items are left out of the download
          and the saved PDF.
        </p>
      )}
    </>
  );
}

/** Signatures (placed by count: 1 → right, 2 → both edges, 3–4 → spread) plus
 *  the processed-at / authentication / NOTE footer lines. */
function ReportFooterBlock({ data }: { data: LabReportData }) {
  const processedAtLine = [
    data.processedAt?.name,
    data.processedAt?.address,
    data.processedAt?.city,
  ]
    .filter(Boolean)
    .join(', ');

  // Signature placement around a centred QR (like the LIS): split the signers
  // into a left and right group so the QR sits in the middle — sig · QR · sig.
  const signers = data.signers;
  const leftCount = Math.floor(signers.length / 2);
  const left = signers.slice(0, leftCount);
  const right = signers.slice(leftCount);
  const Sig = (s: LabReportSigner) => (
    <div key={s.id} className="text-center text-[10px] [break-inside:avoid]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={s.signatureDataUrl ?? `/api/reporting/signature/${s.id}`}
        alt={s.doctorName ?? 'Signature'}
        className="mb-0.5 mx-auto h-8 w-auto object-contain"
      />
      <p className="font-semibold leading-tight">{s.doctorName ?? ''}</p>
      {s.designation && <p className="leading-tight text-gray-600">{s.designation}</p>}
    </div>
  );

  return (
    <>
      {(signers.length > 0 || data.qrDataUrl) && (
        <div className="flex items-end gap-4 pt-1.5 [break-inside:avoid]">
          <div className="flex flex-1 items-end justify-start gap-6">{left.map(Sig)}</div>
          {data.qrDataUrl && (
            <div className="shrink-0 text-center text-[8px] text-gray-500 [break-inside:avoid]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.qrDataUrl}
                alt="Scan to download / verify this report"
                className="mx-auto h-12 w-12"
              />
              <p className="mt-0.5 leading-tight">Scan to verify</p>
            </div>
          )}
          <div className="flex flex-1 items-end justify-end gap-6">{right.map(Sig)}</div>
        </div>
      )}
      <div className="mt-1 border-t border-gray-300 pt-1 text-[9px] text-gray-500">
        {processedAtLine && (
          <p>
            <span className="font-semibold">Processed at:</span> {processedAtLine}
            {data.processedAt?.phone ? ` — Ph: ${data.processedAt.phone}` : ''}
          </p>
        )}
        <p className="mt-0.5">
          This is an electronically authenticated report. Report printed date:{' '}
          {fmtIST(data.printedAt)}
        </p>
        <p className="mt-0.5">
          NOTE: Assay results should be correlated clinically with other clinical
          findings and the total clinical status of the patient.
        </p>
      </div>
    </>
  );
}

/** The per-test tick box shown beside a name in preview mode. Ticked = the test
 *  is included in the PDF; hidden entirely in the headless print render. When a
 *  parent profile is unticked its children are disabled (forced off). */
function IncludeToggle({
  label,
  excluded,
  onToggle,
  disabled,
}: {
  label: string;
  excluded: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      checked={!excluded}
      disabled={disabled}
      onChange={onToggle}
      title={
        disabled
          ? 'Re-tick the parent to choose individual items'
          : excluded
            ? `Include ${label} in the PDF`
            : `Exclude ${label} from the PDF`
      }
      aria-label={`Include ${label} in the PDF`}
      className="mt-[3px] h-3 w-3 shrink-0 cursor-pointer accent-[#2b2b6b] disabled:cursor-not-allowed disabled:opacity-50 print:hidden"
    />
  );
}

/** A profile panel (e.g. LIVER FUNCTION TEST): a parent tick box that cascades
 *  to every child block (sub-groups and standalone tests). */
function PanelBlock({
  panel,
  panelKey,
  childKeyFor,
  interactive,
  excluded,
  onToggle,
  pdf,
  interpretation,
}: {
  panel: SampleReportPanel;
  panelKey: string;
  childKeyFor: (childIndex: number) => string;
  interactive: boolean;
  excluded: Set<string>;
  onToggle: (key: string) => void;
  pdf: boolean;
  /** The profile's own clinical-significance text (Telo sidecar), printed once
   *  below the whole profile. Constituent test interpretations are suppressed. */
  interpretation: string | null;
}) {
  const panelOff = excluded.has(panelKey);
  const kids = panel.children.map((child, ci) => ({ child, ckey: childKeyFor(ci) }));
  const visibleKids = pdf
    ? kids.filter(({ child, ckey }) => {
        if (panelOff || excluded.has(ckey)) return false;
        // A group whose parameter rows are all unticked vanishes with them.
        if (child.kind === 'group' && child.group) {
          return child.group.rows.some((_, ri) => !excluded.has(rowKey(ckey, ri)));
        }
        return true;
      })
    : kids;
  if (pdf && visibleKids.length === 0) return null;

  // Static notes (e.g. TSH) still attach to the profile, from the included
  // parameter rows' test codes.
  const panelCodes: (string | null)[] = [];
  for (const { child, ckey } of kids) {
    if (panelOff || excluded.has(ckey)) continue;
    if (child.kind === 'group' && child.group) {
      child.group.rows.forEach((r, ri) => {
        if (!excluded.has(rowKey(ckey, ri))) panelCodes.push(r.code);
      });
    } else if (child.row) {
      panelCodes.push(child.row.code);
    }
  }
  const panelNotes = notesForCodes(panelCodes);

  return (
    <>
      <tr className={`[break-inside:avoid] ${panelOff ? 'opacity-40' : ''}`}>
        <td colSpan={5} className="pt-2.5 align-top">
          <span className="flex items-start gap-1.5">
            {interactive && (
              <IncludeToggle
                label={panel.title ?? 'profile'}
                excluded={panelOff}
                onToggle={() => onToggle(panelKey)}
              />
            )}
            <span className="font-bold uppercase tracking-wide text-[#2b2b6b]">
              {panel.title ?? ''}
            </span>
          </span>
        </td>
      </tr>
      {visibleKids.map(({ child, ckey }) =>
        renderChild(child, ckey, {
          interactive,
          excludedSet: excluded,
          panelOff,
          pdf,
          onToggle,
        }),
      )}
      {interpretation && <InterpretationRow text={interpretation} dim={panelOff} />}
      <NoteRow notes={panelNotes} dim={panelOff} />
    </>
  );
}

/** Render a panel's child block — a multi-parameter sub-group, or a single test
 *  — indented under the panel, each with its own tick box. */
function renderChild(
  child: SampleReportBlock,
  key: string,
  ctl: {
    interactive: boolean;
    excludedSet: Set<string>;
    panelOff: boolean;
    pdf: boolean;
    onToggle: (key: string) => void;
  },
): ReactNode {
  if (child.kind === 'group' && child.group) {
    return (
      <GroupBlock
        key={key}
        group={child.group}
        groupKey={key}
        interactive={ctl.interactive}
        excludedSet={ctl.excludedSet}
        groupOff={ctl.panelOff || ctl.excludedSet.has(key)}
        disabled={ctl.panelOff}
        onToggle={ctl.onToggle}
        pdf={ctl.pdf}
        indent
        // Interpretation is printed once below the whole profile by PanelBlock.
        hideInterpretation
      />
    );
  }
  if (child.row) {
    return (
      <SingleBlock
        key={key}
        row={child.row}
        interpretation={child.interpretation ?? null}
        interpretationImageDataUrl={child.interpretationImageDataUrl ?? null}
        interactive={ctl.interactive}
        excluded={ctl.panelOff || ctl.excludedSet.has(key)}
        disabled={ctl.panelOff}
        onToggle={() => ctl.onToggle(key)}
        indent
        hideInterpretation
      />
    );
  }
  return null;
}

/** A multi-parameter group: bold header (own tick box), member rows — each with
 *  its own parameter tick box — and interpretation. Unticking the group
 *  cascades to (and disables) its parameter boxes; in PDF mode unticked
 *  parameters are dropped, and the whole group vanishes when none survive. */
function GroupBlock({
  group,
  groupKey,
  interactive,
  excludedSet,
  groupOff,
  onToggle,
  disabled,
  pdf,
  indent,
  hideInterpretation,
}: {
  group: SampleReportGroup;
  groupKey: string;
  interactive: boolean;
  /** Live exclusion set — consulted per parameter row. */
  excludedSet: Set<string>;
  /** The whole group is off (its own untick, or its parent profile's). */
  groupOff: boolean;
  onToggle: (key: string) => void;
  /** Parent profile is unticked — disables this group's tick box. */
  disabled?: boolean;
  pdf?: boolean;
  indent?: boolean;
  /** When inside a profile, the interpretation is printed once below the whole
   *  profile (by PanelBlock) instead of after this group's rows. */
  hideInterpretation?: boolean;
}) {
  // Culture & Sensitivity: render the structured antibiogram (own header lines +
  // Sensitive/Intermediate/Resistant table) under a single group-level tick box,
  // rather than the generic parameter rows. In PDF mode the whole block drops
  // when the group is unticked.
  if (group.culture) {
    if (pdf && groupOff) return null;
    return (
      <>
        <tr className={`[break-inside:avoid] ${groupOff ? 'opacity-40' : ''}`}>
          <td colSpan={5} className={`pt-0.5 align-top ${indent ? 'pl-4' : ''}`}>
            <span className="flex items-start gap-1.5">
              {interactive && (
                <IncludeToggle
                  label={group.title ?? 'test'}
                  excluded={groupOff}
                  onToggle={() => onToggle(groupKey)}
                  disabled={disabled}
                />
              )}
              <span className="font-bold uppercase tracking-wide">{group.title ?? ''}</span>
            </span>
          </td>
        </tr>
        <CultureBlock culture={group.culture} dim={groupOff} indent={indent} />
      </>
    );
  }

  const rowOff = (ri: number) => groupOff || excludedSet.has(rowKey(groupKey, ri));
  const rows = group.rows.map((row, ri) => ({ row, ri }));
  const visibleRows = pdf ? rows.filter(({ ri }) => !rowOff(ri)) : rows;
  if (pdf && visibleRows.length === 0) return null;

  const dim = groupOff ? 'opacity-40' : '';
  const includedCodes = rows.filter(({ ri }) => !rowOff(ri)).map(({ row }) => row.code);
  return (
    <>
      <tr className={`[break-inside:avoid] ${dim}`}>
        <td colSpan={5} className={`pt-0.5 align-top ${indent ? 'pl-4' : ''}`}>
          <span className="flex items-start gap-1.5">
            {interactive && (
              <IncludeToggle
                label={group.title ?? 'test'}
                excluded={groupOff}
                onToggle={() => onToggle(groupKey)}
                disabled={disabled}
              />
            )}
            <span className="font-bold uppercase tracking-wide">{group.title ?? ''}</span>
          </span>
        </td>
      </tr>
      {visibleRows.map(({ row, ri }) => (
        <ResultRow
          key={ri}
          row={row}
          dim={rowOff(ri)}
          indentClass={indent ? 'pl-4' : ''}
          lead={
            interactive ? (
              <IncludeToggle
                label={row.name ?? 'parameter'}
                excluded={rowOff(ri)}
                onToggle={() => onToggle(rowKey(groupKey, ri))}
                disabled={groupOff}
              />
            ) : undefined
          }
        />
      ))}
      {!hideInterpretation && group.interpretation && (
        <InterpretationRow text={group.interpretation} dim={groupOff} />
      )}
      {!hideInterpretation && group.interpretationImageDataUrl && (
        <InterpretationImageRow src={group.interpretationImageDataUrl} dim={groupOff} />
      )}
      {!hideInterpretation && <NoteRow notes={notesForCodes(includedCodes)} dim={groupOff} />}
    </>
  );
}

/** Renders a Culture & Sensitivity microbiology result: the gram-stain /
 *  organism / colony-count header lines, optional remarks, and the ANTIBIOGRAM —
 *  a three-column Sensitive / Intermediate / Resistant table. The LIS stores the
 *  antibiotic lists as newline-separated text in three "… to" parameters; the
 *  read layer splits them into one entry per drug. A "no growth" report shows
 *  "NOT APPLICABLE" in every field. Rendered inside the report's results table,
 *  so the outer cell spans all five columns. */
function CultureBlock({
  culture,
  dim,
  indent,
}: {
  culture: CultureReport;
  dim?: boolean;
  indent?: boolean;
}) {
  const header: Array<[string, string | null]> = [
    ['Gram Stained Smear', culture.gramStain],
    ['Organism Isolated', culture.organism],
    ['Colony Count', culture.colonyCount],
  ];
  const cols = [
    {
      title: 'Sensitive',
      items: culture.sensitive,
      head: '#f7dcdc',
      body: '#fdf5f5',
      border: '#edc6c6',
      text: '#9f1239',
      dot: '#e11d48',
    },
    {
      title: 'Intermediate',
      items: culture.intermediate,
      head: '#e9ecf1',
      body: '#fafbfc',
      border: '#d6dbe3',
      text: '#475569',
      dot: '#94a3b8',
    },
    {
      title: 'Resistant',
      items: culture.resistant,
      head: '#d7ecda',
      body: '#f5faf5',
      border: '#bfe0c5',
      text: '#15803d',
      dot: '#16a34a',
    },
  ];
  const isNA = (s: string) => /^\s*not applicable\s*$/i.test(s);
  const hasAbx = cols.some((c) => c.items.length > 0);
  return (
    <tr className={dim ? 'opacity-40' : ''}>
      <td colSpan={5} className={`pb-2 pt-0.5 ${indent ? 'pl-4' : ''}`}>
        <div className="[break-inside:avoid] text-[12px]">
          <table className="mb-2">
            <tbody>
              {header.map(([label, value]) =>
                value ? (
                  <tr key={label} className="align-top">
                    <td className="py-0.5 pr-3 font-medium">{label}</td>
                    <td className="py-0.5 pr-2 text-gray-500">:</td>
                    <td className="py-0.5">{value}</td>
                  </tr>
                ) : null,
              )}
              {culture.remarks && (
                <tr className="align-top">
                  <td className="pt-1.5 pr-3 font-medium">Remarks</td>
                  <td className="pt-1.5 pr-2 text-gray-500">:</td>
                  <td className="pt-1.5">{culture.remarks}</td>
                </tr>
              )}
            </tbody>
          </table>

          {hasAbx && (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-center gap-2.5">
                <span className="h-px w-8 bg-gray-300" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2b2b6b]">
                  Antibiogram
                </span>
                <span className="h-px w-8 bg-gray-300" />
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {cols.map((c) => {
                  const drugs = c.items.filter((it) => !isNA(it));
                  return (
                    <div
                      key={c.title}
                      className="flex flex-col overflow-hidden rounded-lg border"
                      style={{ borderColor: c.border }}
                    >
                      <div
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5"
                        style={{ backgroundColor: c.head }}
                      >
                        <span
                          className="text-[11px] font-semibold uppercase tracking-wide"
                          style={{ color: c.text }}
                        >
                          {c.title}
                        </span>
                        {drugs.length > 0 && (
                          <span
                            className="rounded-full px-1.5 text-[9px] font-bold leading-[1.4]"
                            style={{ backgroundColor: 'rgba(255,255,255,0.65)', color: c.text }}
                          >
                            {drugs.length}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 px-3 py-2" style={{ backgroundColor: c.body }}>
                        {drugs.length > 0 ? (
                          <ul className="space-y-1">
                            {drugs.map((it, i) => (
                              <li key={i} className="flex items-start gap-1.5 leading-snug">
                                <span
                                  className="mt-[5px] h-1 w-1 shrink-0 rounded-full"
                                  style={{ backgroundColor: c.dot }}
                                />
                                <span>{it}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="py-0.5 text-center text-[11px] italic text-gray-400">
                            Not applicable
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

/** A standalone test row (own tick box) plus its own interpretation. */
function SingleBlock({
  row,
  interpretation,
  interpretationImageDataUrl,
  interactive,
  excluded,
  onToggle,
  disabled,
  indent,
  hideInterpretation,
}: {
  row: SampleReportRow;
  interpretation: string | null;
  /** Interpretation stored as an image (data-URI), printed below the text. */
  interpretationImageDataUrl?: string | null;
  interactive: boolean;
  excluded: boolean;
  onToggle: () => void;
  disabled?: boolean;
  indent?: boolean;
  /** When inside a profile, the interpretation is printed once below the whole
   *  profile (by PanelBlock) instead of right after this row. */
  hideInterpretation?: boolean;
}) {
  const lead = interactive ? (
    <IncludeToggle
      label={row.name ?? 'test'}
      excluded={excluded}
      onToggle={onToggle}
      disabled={disabled}
    />
  ) : null;
  return (
    <>
      <ResultRow row={row} dim={excluded} lead={lead} indentClass={indent ? 'pl-4' : ''} />
      {!hideInterpretation && interpretation && (
        <InterpretationRow text={interpretation} dim={excluded} />
      )}
      {!hideInterpretation && interpretationImageDataUrl && (
        <InterpretationImageRow src={interpretationImageDataUrl} dim={excluded} />
      )}
      {!hideInterpretation && <NoteRow notes={notesForCodes([row.code])} dim={excluded} />}
    </>
  );
}

function ResultRow({
  row,
  dim,
  lead,
  indentClass,
}: {
  row: SampleReportRow;
  dim?: boolean;
  lead?: ReactNode;
  indentClass?: string;
}) {
  const dimClass = dim ? 'opacity-40' : '';
  return (
    <>
      <tr className={`align-top ${dimClass}`}>
        <td className={`py-0.5 pr-3 ${indentClass ?? ''}`}>
          <div className="flex items-start gap-1.5">
            {lead}
            <div className="text-[12px] font-medium">{row.name ?? '—'}</div>
          </div>
        </td>
        <td className="py-0.5 pr-3">
          <span className={row.abnormal ? 'text-[13px] font-bold text-red-700' : ''}>{row.value ?? '—'}</span>
        </td>
        <td className="py-0.5 pr-3">{row.unit ?? '—'}</td>
        <td className="whitespace-pre-line py-0.5 text-[10px] leading-tight text-gray-700">
          {formatRange(row.range)}
        </td>
        <td className="py-0.5 text-[8px] leading-tight text-gray-600">{row.method ?? '—'}</td>
      </tr>
      {row.comments && (
        <tr className={dimClass}>
          <td colSpan={5} className="pb-1 text-[10px] text-gray-800">
            <span className="font-bold">Doctor&apos;s Note:</span>{' '}
            <span className="font-bold">{row.comments}</span>
          </td>
        </tr>
      )}
    </>
  );
}

function InterpretationRow({ text, dim }: { text: string; dim?: boolean }) {
  const { heading, body } = splitInterp(text);
  return (
    <tr className={dim ? 'opacity-40' : ''}>
      <td colSpan={5} className="py-1">
        <div className="border border-gray-300 p-2 [break-inside:avoid]">
          <p className="mb-0.5 text-[11px] font-semibold">{heading}</p>
          <p className="whitespace-pre-line text-[10.5px] leading-snug text-gray-700">{body}</p>
        </div>
      </td>
    </tr>
  );
}

/** An interpretation stored as an image (e.g. the HBV / HCV graph), inlined as a
 *  data-URI. Some tests carry ONLY this image and no interpretation text; it
 *  prints below any text interpretation, kept whole on the page. */
function InterpretationImageRow({ src, dim }: { src: string; dim?: boolean }) {
  return (
    <tr className={dim ? 'opacity-40' : ''}>
      <td colSpan={5} className="py-1">
        <div className="[break-inside:avoid]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="Interpretation" className="mx-auto h-auto max-w-full" />
        </div>
      </td>
    </tr>
  );
}

/** A test/profile's static "Note" list, printed at the end of ITS section and
 *  kept together (never split across a page). */
function NoteRow({ notes, dim }: { notes: string[]; dim?: boolean }) {
  if (notes.length === 0) return null;
  return (
    <tr className={dim ? 'opacity-40' : ''}>
      <td colSpan={5} className="pt-1">
        <div className="[break-inside:avoid]">
          <p className="mb-0.5 font-semibold">Note</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-[10px] leading-tight text-gray-800">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ol>
        </div>
      </td>
    </tr>
  );
}

function Meta({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-28 shrink-0 text-gray-500">{label}</span>
      <span className="text-gray-400">:</span>
      <span className={`${strong ? 'font-semibold' : ''} ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value}
      </span>
    </div>
  );
}
