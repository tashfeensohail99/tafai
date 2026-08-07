/**
 * Source-IP derivation + allow-list matching for the Telenor Smart Office
 * endpoint. Split out of the guard so the tricky parts (proxy chains, IPv6-
 * mapped IPv4, CIDR) are unit-testable.
 */

/**
 * Normalise an address for comparison:
 *   - `::ffff:202.166.165.124` (IPv6-mapped IPv4) -> `202.166.165.124`
 *   - `[2001:db8::1]:443` / `202.166.165.124:51234` -> host only
 *   - `fe80::1%eth0` -> zone id dropped, lower-cased
 * Node hands us the mapped form on a dual-stack socket, so an allow-list
 * written as plain IPv4 would never match the raw value.
 */
export function normalizeIp(raw: string): string {
  let ip = (raw ?? '').trim();
  if (!ip) return '';
  // [v6]:port -> v6
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracketed) ip = bracketed[1];
  // v4:port -> v4 (a bare IPv6 has >1 colon, so this can't eat one)
  else if ((ip.match(/:/g) ?? []).length === 1 && ip.includes('.')) ip = ip.split(':')[0];
  ip = ip.split('%')[0].toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) ip = mapped[1];
  return ip;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/**
 * Is this one of OUR OWN infrastructure hops rather than a real caller?
 * Railway's edge/router hops sit on private + CGNAT space, so anything in
 * these ranges is a proxy we put there, never the Telenor PBX.
 */
export function isInfraHop(ip: string): boolean {
  const n = normalizeIp(ip);
  if (!n) return true;
  if (n === '::1' || n.startsWith('fc') || n.startsWith('fd') || n.startsWith('fe80')) return true;
  const v = ipv4ToInt(n);
  if (v === null) return false;
  const inRange = (cidrBase: string, bits: number): boolean => {
    const base = ipv4ToInt(cidrBase);
    if (base === null) return false;
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    return (v & mask) >>> 0 === (base & mask) >>> 0;
  };
  return (
    inRange('10.0.0.0', 8) ||
    inRange('172.16.0.0', 12) ||
    inRange('192.168.0.0', 16) ||
    inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) ||
    inRange('100.64.0.0', 10) // CGNAT — Railway's internal mesh
  );
}

/**
 * Derive the caller's real IP from the proxy chain.
 *
 * X-Forwarded-For grows left-to-right, each proxy APPENDING the peer it heard
 * from. So the rightmost entries are our own infra and the caller's true
 * address is the RIGHTMOST PUBLIC one. Walking from the right and skipping
 * infra hops is spoofing-resistant: anything the caller forges necessarily sits
 * to the LEFT of the address our edge observed for them.
 *
 * This is why a fixed hop count was the wrong tool — it silently breaks the
 * moment the platform inserts another internal hop.
 */
export function deriveClientIp(
  xForwardedFor: string | undefined,
  reqIp: string | undefined,
  socketAddress: string | undefined,
): { ip: string; chain: string[] } {
  const chain = (xForwardedFor ?? '')
    .split(',')
    .map((s) => normalizeIp(s))
    .filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (!isInfraHop(chain[i])) return { ip: chain[i], chain };
  }
  // No public hop in the chain (or no XFF at all) — fall back to what the
  // framework and the socket report, in that order.
  const fallback = [normalizeIp(reqIp ?? ''), normalizeIp(socketAddress ?? '')].find(Boolean) ?? '';
  return { ip: fallback, chain };
}

/**
 * Match an address against one allow-list entry. Accepts an exact IP or an
 * IPv4 CIDR (`202.166.165.0/24`) — a carrier NATs its outbound calls across a
 * pool, so pinning single addresses turns into whack-a-mole every time they
 * add a gateway.
 */
export function matchesAllowEntry(ip: string, entry: string): boolean {
  const target = normalizeIp(ip);
  const raw = (entry ?? '').trim();
  if (!target || !raw) return false;
  if (!raw.includes('/')) return normalizeIp(raw) === target;

  const [base, bitsRaw] = raw.split('/');
  const bits = Number(bitsRaw);
  const baseInt = ipv4ToInt(normalizeIp(base));
  const targetInt = ipv4ToInt(target);
  if (baseInt === null || targetInt === null) return false;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
  return ((targetInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

/** True when the address matches any entry in the allow-list. */
export function isAllowed(ip: string, allow: string[]): boolean {
  return allow.some((entry) => matchesAllowEntry(ip, entry));
}
