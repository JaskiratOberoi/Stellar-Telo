/**
 * Single source of truth for date/time display across Telo. Always IST
 * (Asia/Kolkata) regardless of the runtime's timezone — server and client
 * produce identical output, so there's no SSR/CSR hydration drift to gate.
 */
const IST = 'Asia/Kolkata' as const;

type Kind = 'date' | 'time' | 'datetime';

const datetimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

/** Format an ISO string (or Date) in IST. Returns '—' for null/undefined/invalid. */
export function fmtIST(
  input: string | Date | null | undefined,
  kind: Kind = 'datetime',
): string {
  if (input == null || input === '') return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  if (kind === 'date') return dateFmt.format(d);
  if (kind === 'time') return timeFmt.format(d);
  return datetimeFmt.format(d);
}
