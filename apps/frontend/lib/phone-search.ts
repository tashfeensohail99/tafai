/**
 * Phone-aware matching for the client-side list filters.
 *
 * Numbers are stored canonicalised (`+923219566502`) but everyone types them
 * locally (`03219566502`) — reception writes the local form on the visit slip,
 * and that is the number staff paste into the search box. A plain
 * `.includes()` finds nothing, because `+923219566502` does not contain
 * `03219566502`: after the `92` comes `3219566502`, with no leading `0`.
 *
 * Mirrors apps/backend/src/common/phone/phone-search.util.ts — keep the two in
 * step, since the same number must resolve the same way whether a page filters
 * in the browser (the sales lists) or queries the API.
 */

/** Below this many digits a term is treated as text, so typing "3" doesn't
 *  match every number containing a 3. */
const MIN_PHONE_SEARCH_DIGITS = 6;

/** Digits only — strips +, spaces, dashes, brackets. */
export function digitsOf(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * National significant number: drop the `92` country code and any trunk `0`, so
 * `03219566502`, `+923219566502`, `923219566502` — and the malformed
 * `+9203219566502` from the old webhook bug — all reduce to `3219566502`.
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
 * Does the stored number match what was typed, in any format? Compares national
 * significant numbers and allows either to be a suffix of the other, so a rep
 * can type the last few digits and still land on the record.
 */
export function phoneMatches(
  stored: string | null | undefined,
  term: string | null | undefined,
): boolean {
  if (!looksLikePhoneSearch(term)) return false;
  const t = nationalSignificant(term);
  const s = nationalSignificant(stored);
  if (!t || !s) return false;
  return s === t || s.endsWith(t) || t.endsWith(s);
}
