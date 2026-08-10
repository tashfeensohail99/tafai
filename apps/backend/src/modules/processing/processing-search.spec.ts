import { buildProcessingSearchAnd } from './processing-search';

describe('buildProcessingSearchAnd', () => {
  const perToken = (t: string) => ({ OR: [{ firstName: { contains: t } }, { lastName: { contains: t } }] });

  it('returns undefined for empty / whitespace / null / undefined input', () => {
    expect(buildProcessingSearchAnd(undefined, perToken)).toBeUndefined();
    expect(buildProcessingSearchAnd('', perToken)).toBeUndefined();
    expect(buildProcessingSearchAnd('   ', perToken)).toBeUndefined();
  });

  it('wraps a single-word search in AND-of-one so behaviour is unchanged', () => {
    // Semantically identical to the old direct-OR: one token, one OR clause.
    expect(buildProcessingSearchAnd('abdul', perToken)).toEqual({
      AND: [{ OR: [{ firstName: { contains: 'abdul' } }, { lastName: { contains: 'abdul' } }] }],
    });
  });

  it('splits multi-word input on whitespace so each token must match somewhere', () => {
    // The reported bug: "abdul qadir" used to match zero rows because neither
    // firstName nor lastName contained the space. Now each token gets its own
    // OR and both must hit — Abdul Qadir matches.
    const out = buildProcessingSearchAnd('abdul qadir', perToken);
    expect(out?.AND).toHaveLength(2);
    expect(out?.AND[0]).toEqual({
      OR: [{ firstName: { contains: 'abdul' } }, { lastName: { contains: 'abdul' } }],
    });
    expect(out?.AND[1]).toEqual({
      OR: [{ firstName: { contains: 'qadir' } }, { lastName: { contains: 'qadir' } }],
    });
  });

  it('tolerates messy whitespace between tokens', () => {
    const out = buildProcessingSearchAnd('   abdul    qadir   ', perToken);
    expect(out?.AND).toHaveLength(2);
  });

  it('is order-insensitive across tokens because ANDs commute', () => {
    // "qadir abdul" produces the same clauses as "abdul qadir" -- just
    // reordered inside AND. Order-flipped queries should match the same rows.
    const forwards = buildProcessingSearchAnd('abdul qadir', perToken);
    const backwards = buildProcessingSearchAnd('qadir abdul', perToken);
    expect(new Set(forwards?.AND)).toEqual(new Set(backwards?.AND));
  });
});
