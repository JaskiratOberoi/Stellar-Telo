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

// ── IST calendar-day helpers ────────────────────────────────────────────────
// `new Date().toISOString().slice(0,10)` yields the UTC day, which is the
// PREVIOUS IST day between 00:00–05:30 IST — that's the "Today shows yesterday"
// bug in the date filters. These helpers compute the IST calendar day instead.
// IST has no DST, so date strings can be shifted with pure arithmetic.

const ymdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The IST calendar day of `input` (default: now) as 'YYYY-MM-DD'. */
export function ymdIST(input: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD; timeZone forces the IST calendar day.
  return ymdFmt.format(input);
}

/** Today's IST calendar day as 'YYYY-MM-DD'. */
export function todayIST(): string {
  return ymdIST();
}

/** Shift a 'YYYY-MM-DD' by `days` (can be negative). Pure UTC-noon arithmetic
 *  so it never crosses a day boundary; IST has no DST to worry about. */
export function addDaysIST(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** First day of the IST month containing `ymd` (default: today). */
export function firstOfMonthIST(ymd: string = todayIST()): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** First day of the IST month BEFORE the one containing `ymd`. */
export function firstOfLastMonthIST(ymd: string = todayIST()): string {
  const [y, m] = ymd.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}-01`;
}

/** Last day of the IST month BEFORE the one containing `ymd` (= day before the
 *  first of this month). */
export function lastDayOfLastMonthIST(ymd: string = todayIST()): string {
  return addDaysIST(firstOfMonthIST(ymd), -1);
}
