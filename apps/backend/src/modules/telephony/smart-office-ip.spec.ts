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
  it('takes the caller address when the platform adds ONE hop', () => {
    const { ip } = deriveClientIp('202.166.165.124', '202.166.165.124', '::ffff:10.0.0.5');
    expect(ip).toBe('202.166.165.124');
  });

  it('still finds the caller when the platform adds an EXTRA internal hop', () => {
    // This is the case a fixed hop count of 1 gets wrong: the rightmost entry
    // is Railway's own router, not Telenor.
    const { ip } = deriveClientIp(
      '202.166.165.124, 10.0.0.5',
      '10.0.0.5',
      '::ffff:10.0.0.7',
    );
    expect(ip).toBe('202.166.165.124');
  });

  it('skips CGNAT hops (Railway internal mesh)', () => {
    const { ip } = deriveClientIp('202.166.165.126, 100.64.3.9, 10.0.0.5', '10.0.0.5', undefined);
    expect(ip).toBe('202.166.165.126');
  });

  it('unwraps a mapped IPv4 inside the chain', () => {
    const { ip } = deriveClientIp('::ffff:202.166.165.125, 10.0.0.5', undefined, undefined);
    expect(ip).toBe('202.166.165.125');
  });

  it('IGNORES a forged allow-listed entry to the left of the real address', () => {
    // An attacker sends "X-Forwarded-For: 202.166.165.124"; our edge appends the
    // address it actually observed. The forged hop must never win.
    const { ip } = deriveClientIp('202.166.165.124, 203.0.113.77', undefined, undefined);
    expect(ip).toBe('203.0.113.77');
    expect(isAllowed(ip, TELENOR)).toBe(false);
  });

  it('falls back to req.ip / socket when there is no X-Forwarded-For', () => {
    expect(deriveClientIp(undefined, '202.166.165.122', undefined).ip).toBe('202.166.165.122');
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
  it.each(TELENOR)('admits %s however the proxy presents it', (ip) => {
    expect(isAllowed(deriveClientIp(`${ip}, 10.0.0.5`, '10.0.0.5', undefined).ip, TELENOR)).toBe(true);
    expect(isAllowed(deriveClientIp(`::ffff:${ip}`, undefined, undefined).ip, TELENOR)).toBe(true);
  });

  it('refuses an unknown address', () => {
    expect(isAllowed('203.0.113.10', TELENOR)).toBe(false);
  });

  it('a /24 would admit any gateway in their block', () => {
    expect(isAllowed('202.166.165.130', ['202.166.165.0/24'])).toBe(true);
  });
});
