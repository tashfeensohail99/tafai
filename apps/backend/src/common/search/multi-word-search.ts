/**
 * Multi-word search for lists that "search by name / phone / etc."
 *
 * The naive pattern -- passing the whole query string as `contains` against
 * firstName OR lastName -- silently returns zero rows for any full name typed
 * with a space, because neither column contains a space. Reported by Wajiha
 * for the processing queue 2026-08-10 (client Abdul Qadir invisible when
 * searched as "abdul qadir"). The same shape existed in eight modules; a
 * greppable sweep replaces all of them with this helper.
 *
 * The helper splits on whitespace and AND-s each token's OR clause together,
 * so "abdul qadir" requires "abdul" somewhere AND "qadir" somewhere. Order-
 * insensitive by construction (AND commutes) and tolerant of extra whitespace.
 * A single-word search yields `AND: [{ OR: [...] }]`, semantically identical
 * to the old direct-OR -- so no callsite changes behaviour for single-word
 * queries.
 *
 * The caller supplies the per-token OR block, so this file stays
 * schema-agnostic; the generic T is Prisma's `<Model>WhereInput`.
 */
export function matchAllTokens<T>(
  search: string | undefined,
  perToken: (token: string) => T,
): { AND: T[] } | undefined {
  const tokens = (search ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;
  return { AND: tokens.map(perToken) };
}
