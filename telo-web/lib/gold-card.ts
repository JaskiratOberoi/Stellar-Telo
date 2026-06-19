/**
 * Gold Card detail validation — shared by the New Order form (client) and
 * registerOrder (server) so both enforce the SAME "real details" rules. A
 * plain module (no 'use server' / server-only) so either side can import it.
 *
 * These are deliberately lenient on format (the exact card scheme isn't known
 * here) but reject trivially-fake entries like "1" or "x" so the 50% benefit
 * can't be claimed without entering a plausible card + name.
 */
export const GOLD_CARD_MIN_NUMBER_LEN = 4;
export const GOLD_CARD_MIN_HOLDER_LEN = 3;

/** A card number: ≥4 chars, starting alphanumeric, then alphanumerics with
 *  optional space/hyphen separators. Blocks "1", "x", "--", etc. */
export function isValidGoldCardNumber(raw: string | null | undefined): boolean {
  const v = (raw ?? '').trim();
  return (
    v.length >= GOLD_CARD_MIN_NUMBER_LEN &&
    /^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(v)
  );
}

/** A holder name: ≥3 chars and contains at least one letter (not just digits
 *  or symbols), so "123" or "." won't pass as a name. */
export function isValidGoldCardHolder(raw: string | null | undefined): boolean {
  const v = (raw ?? '').trim();
  return v.length >= GOLD_CARD_MIN_HOLDER_LEN && /[A-Za-z]/.test(v);
}
