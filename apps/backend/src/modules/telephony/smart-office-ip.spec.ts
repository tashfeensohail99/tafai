import { deriveClientIp, isAllowed, matchesAllowEntry, normalizeIp } from './smart-office-ip';

// The real Telenor Smart Office gateways as supplied by their team.
const TELENOR = [
  '202.166.165.124',
  '202.166.165.122',
  '202.166.165.125',
  '202.166.165.126',
];

describe('normalizeIp', () => {
  it('unwraps IPv6-mapped IPv4 (what a dual-stack socket reports)', () => {
    expect(normalizeIp('::ffff:202.166.165.124')).toBe('202.166.165.124');
  });

  it('strips ports and IPv6 zone ids', () => {
    expect(normalizeIp('202.166.165.124:51234')).toBe('202.166.165.124');
    expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
  });

  it('trims surrounding whitespace from a split X-Forwarded-For', () => {
    expect(normalizeIp('  202.166.165.122 ')).toBe('202.166.165.122');
  });
});

describe('deriveClientIp', () => {
  // Measured production shape, 2026-08-07:
  //   X-Forwarded-For: <caller> -> 152.233.15.120   (Railway edge, PUBLIC)
  //   socket.remoteAddress: 100.64.0.8              (internal router, CGNAT)
  const RAILWAY_EDGE = '152.233.15.120';
  const RAILWAY_SOCKET = '100.64.0.8';

  it('trusts the address Express resolved from the real production chain', () => {
    const { ip } = deriveClientIp(
      `202.166.165.124, ${RAILWAY_EDGE}`,
      '202.166.165.124', // what `trust proxy: 2` yields
      RAILWAY_SOCKET,
    );
    expect(ip).toBe('202.166.165.124');
    expect(isAllowed(ip, TELENOR)).toBe(true);
  });

  it('does NOT mistake Railway\'s public edge for the caller', () => {
    // The regression that caused the persistent 403: the edge is on a public
    // address, so "rightmost non-private hop" resolved to the edge and refused
    // every caller. Express's walk must win over any local heuristic.
    const { ip } = deriveClientIp(
      `202.166.165.122, ${RAILWAY_EDGE}`,
      '202.166.165.122',
      RAILWAY_SOCKET,
    );
    expect(ip).not.toBe(RAILWAY_EDGE);
    expect(ip).toBe('202.166.165.122');
  });

  it('unwraps a mapped IPv4 from the resolved address', () => {
    const { ip } = deriveClientIp(undefined, '::ffff:202.166.165.125', undefined);
    expect(ip).toBe('202.166.165.125');
  });

  it('keeps the full chain for the diagnostic log', () => {
    const { chain } = deriveClientIp(`202.166.165.126, ${RAILWAY_EDGE}`, '202.166.165.126', undefined);
    expect(chain).toEqual(['202.166.165.126', RAILWAY_EDGE]);
  });

  it('IGNORES a forged entry, because Express walks past it', () => {
    // Attacker sends "X-Forwarded-For: 202.166.165.124"; the edge appends what
    // it actually observed, so proxyaddr resolves to the attacker, not the
    // forged hop.
    const { ip } = deriveClientIp(
      `202.166.165.124, 203.0.113.77, ${RAILWAY_EDGE}`,
      '203.0.113.77',
      RAILWAY_SOCKET,
    );
    expect(ip).toBe('203.0.113.77');
    expect(isAllowed(ip, TELENOR)).toBe(false);
  });

  it('falls back to the chain / socket only when nothing was resolved', () => {
    expect(deriveClientIp('202.166.165.122, 10.0.0.5', undefined, undefined).ip).toBe(
      '202.166.165.122',
    );
    expect(deriveClientIp('', undefined, '::ffff:202.166.165.122').ip).toBe('202.166.165.122');
  });
});

describe('matchesAllowEntry', () => {
  it('matches an exact IP', () => {
    expect(matchesAllowEntry('202.166.165.124', '202.166.165.124')).toBe(true);
    expect(matchesAllowEntry('202.166.165.123', '202.166.165.124')).toBe(false);
  });

  it('matches a mapped IPv4 against a plain IPv4 entry', () => {
    expect(matchesAllowEntry('::ffff:202.166.165.124', '202.166.165.124')).toBe(true);
  });

  it('matches an IPv4 CIDR range', () => {
    expect(matchesAllowEntry('202.166.165.200', '202.166.165.0/24')).toBe(true);
    expect(matchesAllowEntry('202.166.166.1', '202.166.165.0/24')).toBe(false);
  });

  it('rejects a malformed entry rather than matching everything', () => {
    expect(matchesAllowEntry('202.166.165.124', '202.166.165.0/99')).toBe(false);
    expect(matchesAllowEntry('202.166.165.124', 'not-an-ip')).toBe(false);
    expect(matchesAllowEntry('202.166.165.124', '')).toBe(false);
  });
});

describe('isAllowed — end to end against the configured Telenor list', () => {
  it.each(TELENOR)('admits %s through the real production chain', (ip) => {
    // As it arrives once `trust proxy` counts both Railway hops.
    expect(
      isAllowed(deriveClientIp(`${ip}, 152.233.15.120`, ip, '100.64.0.8').ip, TELENOR),
    ).toBe(true);
    // And in the mapped-IPv4 form a dual-stack socket reports.
    expect(isAllowed(deriveClientIp(undefined, `::ffff:${ip}`, undefined).ip, TELENOR)).toBe(true);
  });

  it('refuses an unknown address', () => {
    expect(isAllowed('203.0.113.10', TELENOR)).toBe(false);
  });

  it('a /24 would admit any gateway in their block', () => {
    expect(isAllowed('202.166.165.130', ['202.166.165.0/24'])).toBe(true);
  });
});
