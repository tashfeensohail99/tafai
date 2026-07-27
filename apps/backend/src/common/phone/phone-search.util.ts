/**
 * Phone-aware SEARCH support.
 *
 * Numbers are stored canonicalised (`+923219566502`) but everyone types them
 * locally (`03219566502`) — reception records the local form on the visit slip,
 * and that is the number staff then paste into the search box. A raw substring
 * search finds nothing, because `+923219566502` does not *contain*
 * `03219566502`: after the `92` comes `3219566502`, with no leading `0`.
 *
 * These helpers reduce both the typed term and the stored value to the national
 * significant number so any spelling matches any other.
 *
 * NOTE this is search-only and deliberately lenient. Canonicalising a number for
 * STORAGE is `normalisePhone` in ./phone.util; matching an inbound WhatsApp
 * sender to a lead is `findLeadByNormalizedPhone` in ./lead-dedupe. Don't
 * confuse the three — this one must never be used to write a phone number.
 */

/** Below this many digits a term is treated as text, not a phone number, so
 *  typing "3" doesn't match every number containing a 3. */
export const MIN_PHONE_SEARCH_DIGITS = 6;

/** Digits only — strips +, spaces, dashes, brackets. */
export function digitsOf(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * National significant number: drop the `92` country code and any trunk `0`, so
 * `03219566502`, `+923219566502`, `923219566502` — and the malformed
 * `+9203219566502` left behind by the old webhook concat bug — all reduce to
 * `3219566502`.
 *
 * Non-Pakistani numbers are left as-is beyond the leading-zero strip, so they
 * still match themselves exactly.
 */
export function nationalSignificant(value: string | null | undefined): string {
  let d = digitsOf(value);
  if (d.startsWith('92')) d = d.slice(2);
  while (d.startsWith('0')) d = d.slice(1);
  return d;
}

/** True when the term is a phone number rather than a name or reference code. */
export function looksLikePhoneSearch(term: string | null | undefined): boolean {
  const t = (term ?? '').trim();
  if (!t) return false;
  // Only +, digits and the usual separators — "TIS-2026-24892" must not qualify.
  if (!/^\+?[\d\s()\-.]+$/.test(t)) return false;
  return digitsOf(t).length >= MIN_PHONE_SEARCH_DIGITS;
}

/**
 * Every stored spelling of the typed number, for an EQUALITY lookup.
 *
 * Deliberately equality-based: `regexp_replace(phone, …) IN (…)` uses
 * `leads_phone_digits_idx`, whereas an unanchored `LIKE '%digits%'` over the
 * same expression forces the full-table regex scan that took 21s before that
 * index existed (see the July DB-saturation fix). Keep it that way.
 */
export function phoneSearchCandidates(term: string | null | undefined): string[] {
  const nsn = nationalSignificant(term);
  if (!nsn) return [];
  const raw = digitsOf(term);
  return Array.from(
    new Set([nsn, `0${nsn}`, `92${nsn}`, `920${nsn}`, raw].filter(Boolean)),
  );
}
