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
 * BILIRUBIN, or a standalone test like AST) keeps its own tick box too.
 * Unticking dims the item and posts the excluded keys up to the preview modal,
 * which forwards them to the PDF route — so the saved file contains exactly the
 * ticked tests. In PDF mode the excluded keys arrive via `excludedKeys` and
 * those items are dropped from the render entirely.
 */
'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { fmtIST } from '@/lib/datetime';
import type {
  SampleReportBlock,
  SampleReportDepartment,
  SampleReportGroup,
  SampleReportPanel,
  SampleReportRow,
} from '@/db/read/sampleReport';

/** Derive a heading + body from LIS interpretation text whose leading label
 *  (e.g. "CLINICAL SIGNIFICANCE :", "Note:", "Interpretation:-") becomes the
 *  block heading instead of being repeated inline. */
function splitInterp(s: string): { heading: string; body: string } {
  const m = /^\s*(clinical significance|interpretation|note)\s*:?-?\s*/i.exec(s);
  const heading = m
    ? m[1].replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Interpretation';
  const body = (m ? s.slice(m[0].length) : s).trim();
  return { heading, body };
}

/**
 * Format a biological-reference range. A single value (e.g. "0.35 - 5.50") is
 * returned as-is; a labeled multi-segment range (e.g. "Non Pregnant: 2.8-29.2
 * Pregnant: 9.7-208.5 …") breaks into one "Label: value" line per segment.
 */
function formatRange(s: string | null): string {
  if (!s) return '—';
  const t = s.replace(/\s+/g, ' ').trim();
  const re = /([A-Za-z][A-Za-z ]*?)\s*:\s*(.*?)(?=\s+[A-Za-z][A-Za-z ]*?\s*:|$)/g;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const label = m[1].trim();
    const val = m[2].trim();
    parts.push(val ? `${label}: ${val}` : label);
  }
  return parts.length >= 2 ? parts.join('\n') : t;
}

export interface LabReportSigner {
  id: number;
  doctorName: string | null;
  designation: string | null;
}

export interface LabReportData {
  pdf?: boolean;
  /** Start each department on a new page (the LIS "split" layout). */
  splitByDepartment?: boolean;
  /** Item keys the user unticked — omitted from the PDF render. A top-level item
   *  is "deptIndex:itemIndex"; a panel child is "deptIndex:itemIndex:childIndex".
   *  Excluding a panel key cascades to all its children. Empty/undefined means
   *  "include every test" (the default). */
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
  /** Extra static "Note" lines (e.g. TSH notes) for codes present. */
  staticNotes: string[];
  processedAt: {
    name: string | null;
    address: string | null;
    city: string | null;
    phone: string | null;
  } | null;
  signers: LabReportSigner[];
  printedAt: string;
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

export function LabReport({ data }: { data: LabReportData }) {
  // Preview shows tick boxes and instant client-side dimming; the PDF render is
  // non-interactive and instead drops the excluded items outright.
  const interactive = !data.pdf;

  const processedAtLine = [
    data.processedAt?.name,
    data.processedAt?.address,
    data.processedAt?.city,
  ]
    .filter(Boolean)
    .join(', ');

  // Signature footer placement: 1 → right; 2 → spread to both edges; 3–4 →
  // equal columns left-to-right.
  const signerJustify = data.signers.length === 1 ? 'justify-end' : 'justify-between';
  const signerBlockCls = data.signers.length >= 3 ? 'flex-1 text-center' : 'text-center';

  // "Collected at" — collection-centre name + address + contact.
  const cc = data.collectionCentre;
  const ccAddress = cc ? [cc.address, cc.city].filter(Boolean).join(', ') : '';

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

  // Count selectable leaf tests and how many survive the current selection, so
  // the preview modal can block a download with nothing ticked.
  let totalLeaves = 0;
  let remainingLeaves = 0;
  data.departments.forEach((dept, di) => {
    dept.items.forEach((item, ii) => {
      const key = topKey(di, ii);
      if (item.kind === 'panel' && item.panel) {
        item.panel.children.forEach((_, ci) => {
          totalLeaves += 1;
          if (!leafOff(childKey(di, ii, ci), key)) remainingLeaves += 1;
        });
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

  return (
    <div
      className={`mx-auto w-full max-w-[820px] text-black font-sans text-[11px] leading-snug ${
        data.pdf ? '' : 'bg-white p-8'
      }`}
    >
      {/* ── Recreated Noble letterhead (preview only) ───────────────────── */}
      {!data.pdf && (
        <div className="mb-4 flex items-center gap-4 border-b-2 border-[#2b2b6b] pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/branding/noble-logo.png" alt="Noble Diagnostic Centre" className="h-14 w-auto" />
        </div>
      )}

      {/* The whole report is ONE table. The browser reprints the patient block +
          column headers (<thead>) at the top of every PDF page and the signature
          (<tfoot>) at the bottom of every page, and the test rows (<tbody>)
          fragment cleanly across pages. (Nesting a per-department <table> here
          fails to fragment and blanks the first page; a flex container leaves
          large gaps — both avoided by this flat single-table layout.) */}
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[33%]" />
          <col className="w-[12%]" />
          <col className="w-[11%]" />
          <col className="w-[24%]" />
          <col className="w-[20%]" />
        </colgroup>

        {/* ── Patient header + column headers — repeat at the top of every page ── */}
        <thead>
          <tr>
            <td colSpan={5} className="p-0 align-top">
              <div className="grid grid-cols-2 gap-x-10 gap-y-0.5 border-b border-gray-300 pb-2">
                <Meta label="Name" value={data.patientName ?? '—'} strong />
                <Meta label="Patient Id" value={String(data.pid)} mono />
                <Meta label="Lab No. / SID" value={data.sid} mono strong />
                <Meta label="Age / Gender" value={`${ageLabel(data.age, data.ageUnit)} / ${genderLabel(data.sex)}`} />
                <Meta label="Ref. Customer" value={data.clientCode ?? '—'} />
                <Meta label="Ref. Doctor" value={data.refDoctor ?? 'Self'} />
                {data.specimens && data.specimens.length > 0 && (
                  <Meta label="Specimen" value={data.specimens.join(', ')} />
                )}
                <Meta label="Report Status" value={data.statusLabel ?? '—'} />
                <Meta label="Collected" value={fmtIST(data.collectedAt)} />
                <Meta label="Registered" value={fmtIST(data.registeredAt)} />
                <Meta label="Reported" value={fmtIST(data.reportedAt)} />
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

              {/* Tick-box hint (preview only). */}
              {interactive && totalLeaves > 0 && (
                <p className="mt-2 text-center text-[10px] italic text-gray-500 print:hidden">
                  Tick the tests to include. Unticking a profile drops all its tests;
                  unticked tests are left out of the download and the saved PDF.
                </p>
              )}
            </td>
          </tr>
          <tr className="border-b border-gray-400">
            <th className="py-1 pr-3 text-left font-semibold">Test Name</th>
            <th className="py-1 pr-3 text-left font-semibold">Value</th>
            <th className="py-1 pr-3 text-left font-semibold">Unit</th>
            <th className="py-1 pr-3 text-left font-semibold">Biological Ref Interval</th>
            <th className="py-1 text-left font-semibold">Method</th>
          </tr>
        </thead>

        {/* ── Signatures + footer — repeat at the bottom of every page ───── */}
        <tfoot>
          <tr>
            <td colSpan={5} className="p-0 align-bottom">
              {data.signers.length > 0 && (
                <div className={`flex items-end gap-6 pt-3 [break-inside:avoid] ${signerJustify}`}>
                  {data.signers.map((s) => (
                    <div key={s.id} className={`text-[10px] [break-inside:avoid] ${signerBlockCls}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/reporting/signature/${s.id}`}
                        alt={s.doctorName ?? 'Signature'}
                        className="mb-0.5 mx-auto h-9 w-auto object-contain"
                      />
                      <p className="font-semibold leading-tight">{s.doctorName ?? ''}</p>
                      {s.designation && (
                        <p className="leading-tight text-gray-600">{s.designation}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 border-t border-gray-300 pt-1.5 text-[9px] text-gray-500">
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
            </td>
          </tr>
        </tfoot>

        {/* ── Departments → test rows + static notes + end marker (the content) ─ */}
        <tbody>
          {data.departments.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-4 text-center text-gray-500">
                No results available for this sample.
              </td>
            </tr>
          ) : (
            data.departments.map((dept, di) => {
              // Pair each item with its stable key. In the PDF render, items left
              // empty by the selection (and any department thereby emptied) drop.
              const entries = dept.items.map((item, ii) => ({ item, ii, key: topKey(di, ii) }));
              const visible = interactive
                ? entries
                : entries.filter(({ item, ii, key }) => {
                    if (excluded.has(key)) return false;
                    if (item.kind === 'panel' && item.panel) {
                      return item.panel.children.some(
                        (_, ci) => !excluded.has(childKey(di, ii, ci)),
                      );
                    }
                    return true;
                  });
              if (visible.length === 0) return null;

              return (
                <Fragment key={di}>
                  <tr className={data.splitByDepartment && di > 0 ? '[break-before:page]' : ''}>
                    <td
                      colSpan={5}
                      className="bg-gray-100 px-2 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-[#2b2b6b]"
                    >
                      {dept.name}
                    </td>
                  </tr>
                  {visible.map(({ item, ii, key }) => {
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
                        />
                      );
                    }
                    if (item.kind === 'group' && item.group) {
                      return (
                        <GroupBlock
                          key={key}
                          group={item.group}
                          interactive={interactive}
                          excluded={excluded.has(key)}
                          onToggle={() => toggle(key)}
                        />
                      );
                    }
                    if (item.row) {
                      return (
                        <SingleBlock
                          key={key}
                          row={item.row}
                          interpretation={item.interpretation ?? null}
                          interactive={interactive}
                          excluded={excluded.has(key)}
                          onToggle={() => toggle(key)}
                        />
                      );
                    }
                    return null;
                  })}
                </Fragment>
              );
            })
          )}

          {/* Static notes (e.g. TSH). */}
          {data.staticNotes.length > 0 && (
            <tr>
              <td colSpan={5} className="pt-3">
                <p className="mb-0.5 font-semibold">Note</p>
                <ol className="list-decimal space-y-0.5 pl-5 text-[10px] leading-tight text-gray-800">
                  {data.staticNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ol>
              </td>
            </tr>
          )}

          {/* End marker — printed once, after all content. */}
          <tr>
            <td colSpan={5} className="pt-3 text-center text-[10px] font-semibold tracking-wide text-gray-600">
              *** End of Report ***
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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
          ? 'Re-tick the profile to choose individual tests'
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
}: {
  panel: SampleReportPanel;
  panelKey: string;
  childKeyFor: (childIndex: number) => string;
  interactive: boolean;
  excluded: Set<string>;
  onToggle: (key: string) => void;
  pdf: boolean;
}) {
  const panelOff = excluded.has(panelKey);
  const kids = panel.children.map((child, ci) => ({ child, ckey: childKeyFor(ci) }));
  const visibleKids = pdf
    ? kids.filter(({ ckey }) => !panelOff && !excluded.has(ckey))
    : kids;
  if (pdf && visibleKids.length === 0) return null;

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
          excluded: panelOff || excluded.has(ckey),
          disabled: panelOff,
          onToggle: () => onToggle(ckey),
        }),
      )}
    </>
  );
}

/** Render a panel's child block — a multi-parameter sub-group, or a single test
 *  — indented under the panel, each with its own tick box. */
function renderChild(
  child: SampleReportBlock,
  key: string,
  ctl: { interactive: boolean; excluded: boolean; disabled: boolean; onToggle: () => void },
): ReactNode {
  if (child.kind === 'group' && child.group) {
    return (
      <GroupBlock
        key={key}
        group={child.group}
        interactive={ctl.interactive}
        excluded={ctl.excluded}
        disabled={ctl.disabled}
        onToggle={ctl.onToggle}
        indent
      />
    );
  }
  if (child.row) {
    return (
      <SingleBlock
        key={key}
        row={child.row}
        interpretation={child.interpretation ?? null}
        interactive={ctl.interactive}
        excluded={ctl.excluded}
        disabled={ctl.disabled}
        onToggle={ctl.onToggle}
        indent
      />
    );
  }
  return null;
}

/** A multi-parameter group: bold header (own tick box), member rows, interpretation. */
function GroupBlock({
  group,
  interactive,
  excluded,
  onToggle,
  disabled,
  indent,
}: {
  group: SampleReportGroup;
  interactive: boolean;
  excluded: boolean;
  onToggle: () => void;
  disabled?: boolean;
  indent?: boolean;
}) {
  const dim = excluded ? 'opacity-40' : '';
  return (
    <>
      <tr className={`[break-inside:avoid] ${dim}`}>
        <td colSpan={5} className={`pt-2 align-top ${indent ? 'pl-4' : ''}`}>
          <span className="flex items-start gap-1.5">
            {interactive && (
              <IncludeToggle
                label={group.title ?? 'test'}
                excluded={excluded}
                onToggle={onToggle}
                disabled={disabled}
              />
            )}
            <span>
              <span className="font-bold uppercase tracking-wide">{group.title ?? ''}</span>
              {group.method && (
                <span className="ml-1 text-[9px] italic text-gray-500">(Method: {group.method})</span>
              )}
            </span>
          </span>
        </td>
      </tr>
      {group.rows.map((r, i) => (
        <ResultRow key={i} row={r} dim={excluded} indentClass={indent ? 'pl-4' : ''} />
      ))}
      {group.interpretation && <InterpretationRow text={group.interpretation} dim={excluded} />}
    </>
  );
}

/** A standalone test row (own tick box) plus its own interpretation. */
function SingleBlock({
  row,
  interpretation,
  interactive,
  excluded,
  onToggle,
  disabled,
  indent,
}: {
  row: SampleReportRow;
  interpretation: string | null;
  interactive: boolean;
  excluded: boolean;
  onToggle: () => void;
  disabled?: boolean;
  indent?: boolean;
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
      {interpretation && <InterpretationRow text={interpretation} dim={excluded} />}
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
        <td className={`py-1 pr-3 ${indentClass ?? ''}`}>
          <div className="flex items-start gap-1.5">
            {lead}
            <div className="font-medium">{row.name ?? '—'}</div>
          </div>
        </td>
        <td className="py-1 pr-3">
          <span className={row.abnormal ? 'font-bold text-red-700' : ''}>{row.value ?? '—'}</span>
        </td>
        <td className="py-1 pr-3">{row.unit ?? '—'}</td>
        <td className="whitespace-pre-line py-1 text-[10px] leading-snug text-gray-700">
          {formatRange(row.range)}
        </td>
        <td className="py-1 text-[9px] leading-snug text-gray-600">{row.method ?? '—'}</td>
      </tr>
      {row.comments && (
        <tr className={dimClass}>
          <td colSpan={5} className="pb-1 text-[10px] text-gray-700">
            <span className="font-semibold">Comments:</span> {row.comments}
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
        <div className="border border-gray-300 p-1.5 [break-inside:avoid]">
          <p className="mb-0.5 font-semibold">{heading}</p>
          <p className="whitespace-pre-line text-[9px] leading-tight text-gray-700">{body}</p>
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
