import { matchAllTokens } from './multi-word-search';

describe('matchAllTokens', () => {
  const perToken = (t: string) => ({
    OR: [{ firstName: { contains: t } }, { lastName: { contains: t } }],
  });

  it('returns undefined for empty / whitespace / null / undefined input', () => {
    expect(matchAllTokens(undefined, perToken)).toBeUndefined();
    expect(matchAllTokens('', perToken)).toBeUndefined();
    expect(matchAllTokens('   ', perToken)).toBeUndefined();
  });

  it('wraps a single-word search in AND-of-one so behaviour is unchanged', () => {
    // Semantically identical to the old direct-OR: one token, one OR clause.
    // This is the invariant every caller relies on when they swap the naive
    // form for this helper -- single-word searches must not change results.
    expect(matchAllTokens('abdul', perToken)).toEqual({
      AND: [{ OR: [{ firstName: { contains: 'abdul' } }, { lastName: { contains: 'abdul' } }] }],
    });
  });

  it('splits multi-word input on whitespace so each token must match somewhere', () => {
    // The reported bug: "abdul qadir" used to match zero rows because neither
    // firstName nor lastName contained the space. Now each token gets its own
    // OR and both must hit -- Abdul Qadir matches.
    const out = matchAllTokens('abdul qadir', perToken);
    expect(out?.AND).toHaveLength(2);
    expect(out?.AND[0]).toEqual({
      OR: [{ firstName: { contains: 'abdul' } }, { lastName: { contains: 'abdul' } }],
    });
    expect(out?.AND[1]).toEqual({
      OR: [{ firstName: { contains: 'qadir' } }, { lastName: { contains: 'qadir' } }],
    });
  });

  it('tolerates messy whitespace between tokens', () => {
    const out = matchAllTokens('   abdul    qadir   ', perToken);
    expect(out?.AND).toHaveLength(2);
  });

  it('is order-insensitive across tokens because ANDs commute', () => {
    // "qadir abdul" produces the same clauses as "abdul qadir" -- just
    // reordered inside AND. Order-flipped queries should match the same rows.
    const forwards = matchAllTokens('abdul qadir', perToken);
    const backwards = matchAllTokens('qadir abdul', perToken);
    expect(new Set(forwards?.AND)).toEqual(new Set(backwards?.AND));
  });

  it('handles arbitrarily many tokens', () => {
    // Real name from the DB: "Abdul Sharif Khan Bangash" -- four tokens all
    // required to match, so it composes without special-casing.
    const out = matchAllTokens('abdul sharif khan bangash', perToken);
    expect(out?.AND).toHaveLength(4);
  });

  it('composes with realistic nested per-token shapes', () => {
    // Modules like finance / appointments / follow-ups pass a perToken that
    // returns an OR with NESTED lead / client ORs. This is the shape a
    // reviewer should see and recognise as "safe to reuse everywhere".
    // Verifies the helper doesn't flatten or otherwise mangle the shape --
    // it just wraps whatever the caller returns in AND.
    const complexPerToken = (t: string) => ({
      OR: [
        { invoiceNumber: { contains: t } },
        {
          lead: {
            OR: [{ firstName: { contains: t } }, { lastName: { contains: t } }],
          },
        },
      ],
    });
    const out = matchAllTokens('abdul qadir', complexPerToken);
    // Cast through unknown since the generic T is intentionally opaque here.
    const and = (out as { AND: unknown[] } | undefined)?.AND ?? [];
    expect(and).toHaveLength(2);
    // The helper doesn't flatten or otherwise touch the caller-supplied shape.
    expect(and[0]).toEqual({
      OR: [
        { invoiceNumber: { contains: 'abdul' } },
        { lead: { OR: [{ firstName: { contains: 'abdul' } }, { lastName: { contains: 'abdul' } }] } },
      ],
    });
    expect(and[1]).toEqual({
      OR: [
        { invoiceNumber: { contains: 'qadir' } },
        { lead: { OR: [{ firstName: { contains: 'qadir' } }, { lastName: { contains: 'qadir' } }] } },
      ],
    });
  });
});
