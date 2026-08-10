/**
 * Multi-word name search for the processing manager's queue + case list.
 *
 * The old code did `{ firstName: { contains: search } } OR { lastName: ... }`
 * with the WHOLE query string as `search`. That works for "abdul" (matches
 * firstName), and works for "qadir" (matches lastName), but for "abdul qadir"
 * neither column contains that literal — first names don't have spaces —
 * so the query returned zero rows for a client who is obviously present.
 * Reported by Wajiha (processing manager) 2026-08-10.
 *
 * Splitting on whitespace + AND-ing per-token lets us keep contains-style
 * matching without a trigram index while behaving the way a human expects.
 * "abdul qadir", "qadir abdul", and "abdul   qadir" all match Abdul Qadir.
 * Empty / whitespace-only search returns undefined so the caller can spread it
 * away and get the "no filter" behaviour.
 */
export function buildProcessingSearchAnd<T>(
  search: string | undefined,
  perToken: (token: string) => T,
): { AND: T[] } | undefined {
  const tokens = (search ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;
  return { AND: tokens.map(perToken) };
}
