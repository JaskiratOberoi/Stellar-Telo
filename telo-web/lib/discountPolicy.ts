/**
 * Manual-discount ceiling policy for new orders, keyed by client (MCC) code.
 *
 * The default cap is 20% of the resolved bill total. A few client codes are
 * contractually locked to a tighter ceiling — MDCARE / MEDICARE (the B2C
 * franchise brands) are capped at 10%. This is a pure lookup shared by the
 * client form (live cap + snap-down) and the server action (authoritative
 * gate), so both always agree.
 *
 * Scope note: this governs the New-Order / Patient-Order registration flow
 * only. The super-admin "Edit discount" override on an existing bill is
 * intentionally NOT bound by this (see actions/billing-admin.actions.ts).
 */

/** Default ceiling: 20% of the bill total. */
export const DEFAULT_DISCOUNT_CAP_PCT = 0.2;

/** Client codes (upper-cased) with a tighter, contractually-fixed ceiling. */
const CLIENT_DISCOUNT_CAP_PCT: Record<string, number> = {
  MDCARE: 0.1,
  MEDICARE: 0.1,
};

/** The manual-discount cap fraction (e.g. 0.1 = 10%) for a client code. */
export function discountCapPct(clientCode: string | null | undefined): number {
  const code = (clientCode ?? '').trim().toUpperCase();
  return CLIENT_DISCOUNT_CAP_PCT[code] ?? DEFAULT_DISCOUNT_CAP_PCT;
}

/** The cap as a whole-number percent (e.g. 10) for operator-facing messages. */
export function discountCapLabel(clientCode: string | null | undefined): number {
  return Math.round(discountCapPct(clientCode) * 100);
}

// ── Per-test discount exclusions ────────────────────────────────────────────
// For MDCARE / MEDICARE, a set of tests is billed at contracted floor prices
// (their per-MCC special rates) and must NOT be discountable. Their line value
// is removed from the discountable base, so the manual-discount cap is a % of
// the OTHER tests only. An order made up entirely of these tests allows no
// discount; a mixed order can still discount the non-listed lines as usual.
// Matched by LIS test code (upper-cased). Rule applies to MDCARE/MEDICARE only.
const NON_DISCOUNTABLE_CODES = new Set<string>([
  'HE011', // Complete Blood Count (CBC)
  'BI114', // Glucose - Fasting
  'BI116', // Glucose - Random
  'BI115', // Glucose - Post Prandial (PP)
  'HE017', // Erythrocyte Sedimentation Rate (ESR)
  'CP004', // Complete Urine Examination
  'BI221', // TSH
  'BI034', // Anti-Mullerian Hormone (AMH)
  'BI181', // PSA (Prostate Specific Antigen) Total
  'HE021', // Hemoglobin
  'HE006', // Blood Grouping and Typing (ABO and Rh)
  'BI089', // Creatinine
  'BI224', // Urea
  'BI227', // Uric acid
  'BI209', // Testosterone - Total
]);

const NON_DISCOUNTABLE_BY_CLIENT: Record<string, Set<string>> = {
  MDCARE: NON_DISCOUNTABLE_CODES,
  MEDICARE: NON_DISCOUNTABLE_CODES,
};

const EMPTY_CODES: ReadonlySet<string> = new Set();

/** The set of non-discountable test codes for a client (empty if none apply). */
export function nonDiscountableTestCodes(
  clientCode: string | null | undefined,
): ReadonlySet<string> {
  const code = (clientCode ?? '').trim().toUpperCase();
  return NON_DISCOUNTABLE_BY_CLIENT[code] ?? EMPTY_CODES;
}

/**
 * The discountable portion of a bill total for a client: `total` minus the
 * value of any non-discountable lines. `lines` are the bill's LIS test lines
 * with their billed amount; `total` is the full bill total (including anything
 * not in `lines`, e.g. custom lines, which stay discountable). Never negative.
 * For clients with no exclusions this returns `total` unchanged.
 */
export function discountableTotal(
  clientCode: string | null | undefined,
  lines: { code: string | null | undefined; amount: number }[],
  total: number,
): number {
  const excl = nonDiscountableTestCodes(clientCode);
  if (excl.size === 0) return total;
  let excluded = 0;
  for (const l of lines) {
    if (excl.has((l.code ?? '').trim().toUpperCase())) excluded += l.amount || 0;
  }
  return Math.max(0, total - excluded);
}
