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
