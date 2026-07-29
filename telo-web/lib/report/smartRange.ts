/**
 * Reference-range parsing for the Smart Report's visual gauges.
 *
 * The LIS stores biological reference ranges as validated free text ("0.35 -
 * 5.50", "< 200", "Up to 40", banded multi-line text, sex-split "M: 13 - 17
 * F: 12 - 15", …). The gauge needs numeric bounds, so this module extracts a
 * best-effort {low, high} pair — and when a range can't be understood the
 * Smart Report simply renders the value + range text without a gauge, never a
 * wrong picture.
 */

export interface ParsedRange {
  /** Lower bound of the normal band (undefined for "< x" style ranges). */
  low?: number;
  /** Upper bound of the normal band (undefined for "> x" style ranges). */
  high?: number;
}

export interface GaugeModel {
  /** 'both' = low & high bounds, 'max' = only an upper limit, 'min' = only a lower limit. */
  kind: 'both' | 'max' | 'min';
  low?: number;
  high?: number;
  value: number;
  /** Marker position along the track, 0..1. */
  pos: number;
  /** Where the value sits relative to the parsed bounds. */
  zone: 'normal' | 'low' | 'high';
}

/** First numeric token in a string ("12.3", "1,234", "<0.01" → 0.01). */
export function parseNumericValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, ' ');
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;

/** Parse one line/segment of range text. */
function parseSegment(seg: string): ParsedRange | null {
  const s = seg
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;

  // "a - b" / "a to b" / "a–b"
  let m = s.match(new RegExp(String.raw`(${NUM})\s*(?:-|–|—|to)\s*(${NUM})`, 'i'));
  if (m) {
    const low = Number(m[1]);
    const high = Number(m[2]);
    if (Number.isFinite(low) && Number.isFinite(high) && low < high) return { low, high };
  }

  // "< x" / "<= x" / "up to x" / "upto x" / "below x" / "less than x"
  m = s.match(new RegExp(String.raw`(?:<\s*=?|≤|up\s*to|upto|below|less\s+than)\s*(${NUM})`, 'i'));
  if (m) {
    const high = Number(m[1]);
    if (Number.isFinite(high)) return { high };
  }

  // "> x" / ">= x" / "above x" / "more than x"
  m = s.match(new RegExp(String.raw`(?:>\s*=?|≥|above|more\s+than)\s*(${NUM})`, 'i'));
  if (m) {
    const low = Number(m[1]);
    if (Number.isFinite(low)) return { low };
  }

  return null;
}

/** Labels marking the healthy band inside a banded multi-line range. The
 *  `(?<!in)sufficien` guard is deliberate: it matches "Sufficiency" (the healthy
 *  Vitamin-D band) but NOT "Insufficiency" (which also contains "sufficien" and
 *  would otherwise be mistaken for the healthy band). "Deficiency" doesn't
 *  contain "sufficien" so it's already excluded. */
const NORMAL_BAND =
  /(desirable|normal|optimal|(?<!in)sufficien|adequate|euthyroid|non[-\s]?diabetic|negative|low\s*risk)/i;

/**
 * Parse the LIS free-text range into numeric bounds. `sex` narrows sex-split
 * ranges ("M: 13 - 17 F: 12 - 15") to the patient's own band when it can.
 */
export function parseRange(
  raw: string | null | undefined,
  sex?: string | null,
): ParsedRange | null {
  if (!raw) return null;
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return null;

  // Sex-split ranges: pick the patient's segment when both are present.
  const male = /^m/i.test((sex ?? '').trim());
  const female = /^f/i.test((sex ?? '').trim());
  if (male || female) {
    const mSeg = text.match(/\b(?:males?|m)\s*[:=-]\s*([^\n;]*)/i);
    const fSeg = text.match(/\b(?:females?|f)\s*[:=-]\s*([^\n;]*)/i);
    if (mSeg && fSeg) {
      const own = male ? mSeg[1] : fSeg[1];
      const parsed = parseSegment(own);
      if (parsed) return parsed;
    }
  }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Single-segment range: parse directly.
  if (lines.length === 1) return parseSegment(lines[0]);

  // Banded range: prefer the line labelled as the healthy band.
  const normalLine = lines.find((l) => NORMAL_BAND.test(l));
  if (normalLine) {
    const parsed = parseSegment(normalLine);
    if (parsed) return parsed;
  }
  // Otherwise fall back to the first parseable line (usually the primary band).
  for (const l of lines) {
    const parsed = parseSegment(l);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Build the gauge geometry for a value inside (or outside) its normal band.
 * The normal band occupies the middle 50% of a two-sided track (25%..75%), or
 * 60% of a one-sided track; out-of-range values compress into the alert zones
 * so extreme results never fall off the track.
 */
export function buildGauge(
  valueRaw: string | null | undefined,
  rangeRaw: string | null | undefined,
  sex?: string | null,
): GaugeModel | null {
  const value = parseNumericValue(valueRaw);
  const range = parseRange(rangeRaw, sex);
  if (value == null || !range) return null;

  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

  if (range.low != null && range.high != null) {
    const { low, high } = range;
    const span = high - low;
    if (span <= 0) return null;
    let pos: number;
    let zone: GaugeModel['zone'];
    if (value < low) {
      // Left alert zone: 0.02..0.25, scaled over one band-width below `low`.
      pos = clamp(0.25 - ((low - value) / span) * 0.23, 0.02, 0.25);
      zone = 'low';
    } else if (value > high) {
      pos = clamp(0.75 + ((value - high) / span) * 0.23, 0.75, 0.98);
      zone = 'high';
    } else {
      pos = 0.25 + ((value - low) / span) * 0.5;
      zone = 'normal';
    }
    return { kind: 'both', low, high, value, pos, zone };
  }

  if (range.high != null) {
    // "< x": normal occupies the left 60%.
    const high = range.high;
    const scale = Math.abs(high) > 0 ? Math.abs(high) : 1;
    let pos: number;
    let zone: GaugeModel['zone'];
    if (value <= high) {
      pos = clamp((value / (high || 1)) * 0.6, 0.02, 0.6);
      zone = 'normal';
    } else {
      pos = clamp(0.6 + ((value - high) / scale) * 0.36, 0.6, 0.98);
      zone = 'high';
    }
    return { kind: 'max', high, value, pos, zone };
  }

  if (range.low != null) {
    // "> x": alert occupies the left 40%, normal the right 60%.
    const low = range.low;
    const scale = Math.abs(low) > 0 ? Math.abs(low) : 1;
    let pos: number;
    let zone: GaugeModel['zone'];
    if (value >= low) {
      pos = clamp(0.4 + ((value - low) / scale) * 0.3, 0.4, 0.98);
      zone = 'normal';
    } else {
      pos = clamp(0.4 - ((low - value) / scale) * 0.38, 0.02, 0.4);
      zone = 'low';
    }
    return { kind: 'min', low, value, pos, zone };
  }

  return null;
}
