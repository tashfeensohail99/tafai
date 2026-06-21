/**
 * Sanitises a request body / params before it is stored in an audit log.
 *
 * The audit log is a compliance record, not a data lake: it must NEVER persist
 * secrets (passwords, tokens, API keys, raw file bytes) and must stay small.
 * This walks the value, drops any key whose name looks sensitive, truncates
 * long strings, and caps array length + nesting depth so a stray base64 upload
 * or a huge payload can't bloat the table.
 */

/** Key-name fragments (lower-cased, substring match) whose values are dropped. */
const DENY_FRAGMENTS = [
  'password',
  'passwordhash',
  'token', // accesstoken, refreshtoken, fcmtoken, twoFactor...
  'secret',
  'apikey',
  'authorization',
  'cookie',
  'base64', // receiptContentBase64, fileBase64, contentBase64
  'bytes',
  'buffer',
  'twofactor',
  'otp',
  'pin',
  'cvv',
];

const MAX_STRING = 2000;
const MAX_ARRAY = 50;
const MAX_DEPTH = 5;

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return DENY_FRAGMENTS.some((f) => k.includes(f));
}

function walk(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[truncated:depth]';

  if (typeof value === 'string') {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…[+${value.length - MAX_STRING} chars]`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => walk(v, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`[+${value.length - MAX_ARRAY} more]`);
    return out;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? '[redacted]' : walk(v, depth + 1);
    }
    return out;
  }

  // functions, symbols, bigint, etc. — not auditable
  return undefined;
}

/**
 * Returns a redacted, size-capped deep copy safe to store as audit JSON, or
 * undefined when there's nothing meaningful to record. Never throws.
 */
export function redactForAudit(
  value: unknown,
): Record<string, unknown> | unknown[] | undefined {
  try {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'object') return undefined;
    if (Array.isArray(value)) {
      const arr = walk(value, 0) as unknown[];
      return arr.length ? arr : undefined;
    }
    const obj = walk(value, 0) as Record<string, unknown>;
    return obj && Object.keys(obj).length ? obj : undefined;
  } catch {
    return undefined;
  }
}
