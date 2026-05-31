/**
 * TshReport — presentational TSH (BI221) result report, styled to match the
 * Dr Lal PathLabs reference layout. One component, two consumers:
 *   - the on-screen preview iframe (`/print/reporting/[sid]`), and
 *   - the headless-Chromium PDF render (`?pdf=1`), which is later merged onto
 *     the real Noble letterhead.
 *
 * In `pdf` mode the HTML letterhead header is dropped (the letterhead PDF
 * supplies branding) and top padding clears the printed logo band; otherwise a
 * recreated Noble header is shown so the preview is self-explanatory.
 */
import { fmtIST } from '@/lib/datetime';

/**
 * Standard TSH (BI221) notes. Not carried by the worksheet feed (which only
 * has the per-test Interpretation paragraph), so kept as static report content
 * — matches the numbered "Note" block on the reference reports.
 */
const TSH_NOTES: string[] = [
  'TSH levels are subject to circadian variation, reaching peak levels between 2 - 4 a.m. and a minimum between 6 - 10 pm. The variation is of the order of 50%, hence time of the day has influence on the measured serum TSH concentrations.',
  'Values <0.03 µIU/mL need to be clinically correlated due to presence of a rare TSH variant in some individuals.',
  'Transient increase in TSH levels or abnormal TSH levels can be seen in various nonthyroidal diseases. Simultaneous measurement of TSH with free T4 is useful in evaluating the differential diagnosis.',
];

export interface TshReportResult {
  testName: string | null;
  method: string | null;
  value: string | null;
  unit: string | null;
  normalRange: string | null;
  abnormal: boolean;
  comments: string | null;
}

export interface TshReportSigner {
  id: number;
  doctorName: string | null;
  designation: string | null;
}

export interface TshReportData {
  pdf?: boolean;
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
  /** Profile section title (e.g. "THYROID PROFILE I"); null for a single test. */
  sectionTitle: string | null;
  results: TshReportResult[];
  meta: {
    interpretation: string | null;
  } | null;
  processedAt: {
    name: string | null;
    address: string | null;
    city: string | null;
    phone: string | null;
  } | null;
  signers: TshReportSigner[];
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
  const u = (unit ?? 'Year(s)').trim();
  return `${age} ${u}`;
}

/** Collapse the multi-line biological-reference text to a compact wrapped form. */
function compactRange(s: string | null): string {
  if (!s) return '—';
  return s.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function TshReport({ data }: { data: TshReportData }) {
  // Distinct, non-empty comments across the analytes (usually one shared line).
  const comments = Array.from(
    new Set(
      data.results
        .map((r) => r.comments?.trim())
        .filter((c): c is string => !!c),
    ),
  );
  const processedAtLine = [
    data.processedAt?.name,
    data.processedAt?.address,
    data.processedAt?.city,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      className={`mx-auto flex w-full max-w-[820px] flex-col text-black font-sans text-[11px] leading-snug ${
        data.pdf ? 'min-h-screen px-10 pt-[26mm] pb-[28mm]' : 'bg-white p-8'
      }`}
    >
      {/* ── Recreated Noble letterhead (preview only) ───────────────────── */}
      {!data.pdf && (
        <div className="mb-4 flex items-center gap-4 border-b-2 border-[#2b2b6b] pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/branding/noble-logo.png"
            alt="Noble Diagnostic Centre"
            className="h-14 w-auto"
          />
        </div>
      )}

      {/* ── Patient / sample meta ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-x-10 gap-y-0.5 border-b border-gray-300 pb-2">
        <Meta label="Name" value={data.patientName ?? '—'} strong />
        <Meta label="Patient Id" value={String(data.pid)} mono />
        <Meta label="Lab No. / SID" value={data.sid} mono strong />
        <Meta label="Age / Gender" value={`${ageLabel(data.age, data.ageUnit)} / ${genderLabel(data.sex)}`} />
        <Meta label="Ref. Customer" value={data.clientCode ?? '—'} />
        <Meta label="Ref. Doctor" value={data.refDoctor ?? 'Self'} />
        <Meta label="Report Status" value={data.statusLabel ?? '—'} />
        <Meta label="Collected" value={fmtIST(data.collectedAt)} />
        <Meta label="Registered" value={fmtIST(data.registeredAt)} />
        <Meta label="Reported" value={fmtIST(data.reportedAt)} />
        {data.billNumber && <Meta label="Bill No." value={data.billNumber} mono />}
      </div>

      {processedAtLine && (
        <p className="mt-1 text-[11px] text-gray-600">
          <span className="font-semibold">Processed at:</span> {processedAtLine}
          {data.processedAt?.phone ? ` — Ph: ${data.processedAt.phone}` : ''}
        </p>
      )}

      {data.clinicalHistory && (
        <p className="mt-1 text-[11px] text-gray-600">
          <span className="font-semibold">Clinical history:</span> {data.clinicalHistory}
        </p>
      )}

      {/* ── Title ───────────────────────────────────────────────────────── */}
      <h2 className="mt-3 text-center text-[13px] font-bold uppercase tracking-wide">
        Test Report
      </h2>

      {/* ── Result table ────────────────────────────────────────────────── */}
      <table className="mt-1.5 w-full border-collapse">
        <thead>
          <tr className="border-y border-gray-400">
            <th className="py-1.5 pr-3 text-left font-semibold">Test Name</th>
            <th className="py-1.5 pr-3 text-left font-semibold">Results</th>
            <th className="py-1.5 pr-3 text-left font-semibold">Units</th>
            <th className="py-1.5 text-left font-semibold">Bio. Ref. Interval</th>
          </tr>
        </thead>
        <tbody>
          {data.sectionTitle && (
            <tr>
              <td colSpan={4} className="pt-1.5 font-bold uppercase tracking-wide">
                {data.sectionTitle}
              </td>
            </tr>
          )}
          {data.results.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-2 text-gray-500">
                No result available for this report.
              </td>
            </tr>
          ) : (
            data.results.map((r, i) => (
              <tr key={i} className="align-top">
                <td className="py-1 pr-3">
                  <div className="font-medium">{r.testName ?? '—'}</div>
                  {r.method && (
                    <div className="text-[9px] italic text-gray-500">
                      (Method: {r.method})
                    </div>
                  )}
                </td>
                <td className="py-1 pr-3">
                  <span className={`font-bold ${r.abnormal ? 'text-red-700' : ''}`}>
                    {r.value ?? '—'}
                  </span>
                </td>
                <td className="py-1 pr-3">{r.unit ?? '—'}</td>
                <td className="py-1 text-[10px] text-gray-700">{compactRange(r.normalRange)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {comments.length > 0 && (
        <p className="mt-2 text-[10px]">
          <span className="font-semibold">Comments:</span> {comments.join(' ')}
        </p>
      )}

      {/* ── Note ────────────────────────────────────────────────────────── */}
      <div className="mt-2">
        <p className="mb-0.5 font-semibold">Note</p>
        <ol className="list-decimal space-y-0.5 pl-5 text-[10px] leading-tight text-gray-800">
          {TSH_NOTES.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ol>
      </div>

      {/* ── Interpretation ──────────────────────────────────────────────── */}
      {data.meta?.interpretation && (
        <div className="mt-2 border border-gray-300 p-1.5 [break-inside:avoid]">
          <p className="mb-0.5 font-semibold">Interpretation</p>
          <p className="whitespace-pre-line text-[9px] leading-tight text-gray-700">
            {data.meta.interpretation}
          </p>
        </div>
      )}

      {/* ── Bottom group: signatures + footer, pinned to the page bottom ──── */}
      <div className="mt-auto [break-inside:avoid]">
        {data.signers.length > 0 && (
          <div className="mt-6 flex flex-wrap items-end justify-end gap-8 [break-inside:avoid]">
            {data.signers.map((s) => (
              <div key={s.id} className="text-right text-[10px] [break-inside:avoid]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/reporting/signature/${s.id}`}
                  alt={s.doctorName ?? 'Signature'}
                  className="mb-0.5 ml-auto h-9 w-auto object-contain"
                />
                <p className="font-semibold">{s.doctorName ?? ''}</p>
                {s.designation && <p className="text-gray-600">{s.designation}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 border-t border-gray-300 pt-2 text-[9px] text-gray-500">
          <p>
            This is an electronically authenticated report. Report printed date:{' '}
            {fmtIST(data.printedAt)}
          </p>
          <p className="mt-0.5">
            NOTE: Assay results should be correlated clinically with other clinical
            findings and the total clinical status of the patient.
          </p>
          <p className="mt-1 text-center font-medium">-- End of report --</p>
        </div>
      </div>
    </div>
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
