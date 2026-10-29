/**
 * Deterministic pseudonymisation for the sales-demo mirror of production.
 *
 * Every function here is a PURE mapping keyed by a secret salt: the same real
 * value always produces the same fake value (so a lead's phone on the Lead row,
 * the WhatsAppThread.waContactId and the digits inside a message body all land
 * on the same fake number) and different real values never collide where the
 * schema needs uniqueness (phones are permuted with a bijective
 * format-preserving cipher, not hashed).
 *
 * This file has NO Nest / Prisma imports so the standalone sync CLI, the Nest
 * sync service and the leak checker can all share it.
 */
import { createHmac } from 'crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  CITIES,
  COMPANY_WORDS_A,
  COMPANY_WORDS_B,
  FIRST_NAMES_F,
  FIRST_NAMES_M,
  LAST_NAMES,
  STREET_NAMES,
} from './masking.names';

// ───────────────────────────── configuration ─────────────────────────────────

export interface StaffAlias {
  firstName: string;
  lastName: string;
  /** Optional fixed login email for this staff member in the demo. */
  email?: string;
}

export interface MaskingConfig {
  /** Secret salt. Rotating it re-keys every fake identity. */
  salt: string;
  /** Demo brand that replaces the real tenant name in text. */
  brandName: string;
  /** Short form used where the real code says "Tashfeen Immigration". */
  brandShort?: string;
  /** Domain every masked email is rewritten onto. Use a reserved TLD. */
  emailDomain: string;
  /** Real brand tokens to replace in free text (longest first is handled). */
  brandTokens: string[];
  /**
   * Staff handling. `keep` = real staff identities whose names/emails stay
   * untouched (matched by real email, lower-case). `aliases` = explicit fake
   * identity for a real email. Everyone else is aliased deterministically.
   */
  staff?: {
    keep?: string[];
    aliases?: Record<string, StaffAlias>;
  };
  /** Default country for bare national numbers (e.g. "03001234567"). */
  defaultCountry?: string;
}

export const DEFAULT_MASKING_CONFIG: Omit<MaskingConfig, 'salt'> = {
  brandName: 'Summit Immigration Consultants',
  brandShort: 'Summit Immigration',
  emailDomain: 'summit-demo.example',
  brandTokens: [
    'Tashfeen Immigration Solutions',
    'Tashfeen Immigration',
    'Tashfeen Group',
    'tashfeengroup.com',
    'tashfeen.com',
    'Tashfeen',
  ],
  defaultCountry: 'PK',
};

export interface PersonName {
  firstName: string;
  lastName: string;
}

/** One real→fake name pair the text scrubber should apply inside a thread. */
export interface NameAlias {
  real: PersonName;
  fake: PersonName;
}

export interface ScrubContext {
  /** Lead / client / staff names known to appear in this text. */
  names?: NameAlias[];
  /**
   * Global index of EVERY real person's normalised full name -> fake name,
   * applied after the per-row aliases. Catches names in text that has no
   * link to the person (notifications, timeline, AI runs, free notes).
   */
  nameIndex?: Map<string, PersonName>;
}

// ───────────────────────────── primitives ────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 10–15 digits, optional leading + or 00, optional single separators between
// digits (space, dash, dot, brackets). Long enough to skip reference codes and
// years, short enough to catch every national/international phone style.
const PHONE_RE = /(?:\+|00)?\d(?:[\s\-.()]?\d){9,14}/g;
// Pakistani CNIC: 5-7-1.
const CNIC_RE = /\b\d{5}-\d{7}-\d\b/g;
const WAMID_RE = /wamid\.[A-Za-z0-9+/=_-]+/g;
/**
 * Office landmarks that identify the real tenant even without its name
 * (spelling variants included). Replaced with the demo offices used by the
 * AI orchestrator in DEMO_MODE.
 */
const OFFICE_TOKENS: Array<[RegExp, string]> = [
  [/\bha(?:i|y)?l(?:e|a)?y\s+tower\b/gi, 'Crescent Plaza'],
  [/\bgiga\s+mall\b/gi, 'Horizon Business Centre'],
  [/\bworld\s+trade\s+cent(?:er|re)\b/gi, 'Horizon Business Centre'],
  [/\b3029\s*-?\s*B\b/g, 'Suite 4'],
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class DemoMasker {
  readonly cfg: MaskingConfig;
  private readonly key: Buffer;
  private readonly brandRe: RegExp | null;
  /** Lower-case stems of the real brand (e.g. "tashfeen") for the catch-all pass. */
  private readonly brandStems: string[];
  /** First word of the demo brand ("Summit"), used where only a word fits. */
  private readonly brandWord: string;

  constructor(cfg: MaskingConfig) {
    if (!cfg.salt || cfg.salt.length < 16) {
      throw new Error('DemoMasker: salt must be at least 16 characters');
    }
    this.cfg = { ...DEFAULT_MASKING_CONFIG, ...cfg };
    this.key = createHmac('sha256', 'tafai-demo-mask').update(cfg.salt).digest();
    const tokens = [...(this.cfg.brandTokens ?? [])].sort((a, b) => b.length - a.length);
    this.brandStems = [...new Set(tokens.map((t) => t.toLowerCase().split(/[^a-z0-9]+/)[0]).filter((t) => t.length >= 5))];
    this.brandWord = (this.cfg.brandShort ?? this.cfg.brandName).split(' ')[0] || this.cfg.brandName;
    this.brandRe = tokens.length
      ? new RegExp(`(?<![A-Za-z0-9])(?:${tokens.map(escapeRe).join('|')})(?![A-Za-z0-9])`, 'gi')
      : null;
  }

  // ── hashing helpers ──

  /** HMAC of (kind, value) → 32 bytes. */
  private digest(kind: string, value: string): Buffer {
    return createHmac('sha256', this.key).update(`${kind}\u0000${value}`).digest();
  }

  /** Deterministic unsigned integer in [0, max). */
  int(kind: string, value: string, max: number): number {
    const d = this.digest(kind, value);
    // 48 bits is plenty and stays inside Number precision.
    const n = d.readUIntBE(0, 6);
    return n % max;
  }

  pick<T>(kind: string, value: string, list: readonly T[]): T {
    return list[this.int(kind, value, list.length)];
  }

  hex(kind: string, value: string, len: number): string {
    return this.digest(kind, value).toString('hex').slice(0, len);
  }

  digits(kind: string, value: string, len: number): string {
    let out = '';
    let round = 0;
    while (out.length < len) {
      const d = this.digest(`${kind}#${round++}`, value);
      for (const b of d) {
        out += String(b % 10);
        if (out.length >= len) break;
      }
    }
    return out;
  }

  /**
   * Bijective permutation of an n-digit decimal string (format-preserving):
   * a balanced Feistel network over the smallest even bit-width covering 10^n,
   * with cycle-walking to stay inside [0, 10^n). Same input → same output;
   * distinct inputs → distinct outputs, so unique phone columns stay unique.
   */
  permuteDigits(digitStr: string, tweak: string): string {
    const n = digitStr.length;
    if (n === 0) return digitStr;
    const domain = 10n ** BigInt(n);
    let w = 0;
    while (1n << BigInt(w) < domain) w++;
    if (w % 2 === 1) w++;
    const half = BigInt(w / 2);
    const mask = (1n << half) - 1n;
    const F = (r: bigint, i: number): bigint => {
      const h = this.digest(`fpe|${tweak}|${n}|${i}`, r.toString()).toString('hex').slice(0, 16);
      return BigInt(`0x${h}`) & mask;
    };
    let x = BigInt(digitStr);
    let guard = 0;
    do {
      let L = x >> half;
      let R = x & mask;
      for (let i = 0; i < 6; i++) {
        const t = R;
        R = L ^ F(R, i);
        L = t;
      }
      x = (L << half) | R;
      if (++guard > 10_000) throw new Error('permuteDigits: cycle walk did not terminate');
    } while (x >= domain);
    return x.toString().padStart(n, '0');
  }

  // ── identities ──

  /** Stable fake name for a person key (normalised phone, or an entity id). */
  person(key: string, hint?: { gender?: string | null }): PersonName {
    const g = (hint?.gender ?? '').toUpperCase();
    const pool =
      g === 'FEMALE' ? FIRST_NAMES_F : g === 'MALE' ? FIRST_NAMES_M : this.int('gender', key, 2) ? FIRST_NAMES_F : FIRST_NAMES_M;
    return {
      firstName: this.pick('first', key, pool),
      lastName: this.pick('last', key, LAST_NAMES),
    };
  }

  /** Staff: honour keep-list / explicit aliases, else deterministic alias. */
  staff(realEmail: string | null | undefined, fallbackKey: string, hint?: { gender?: string | null }): PersonName | null {
    const email = (realEmail ?? '').trim().toLowerCase();
    if (email && this.cfg.staff?.keep?.map((e) => e.toLowerCase()).includes(email)) return null;
    const alias = email ? this.cfg.staff?.aliases?.[email] : undefined;
    if (alias) return { firstName: alias.firstName, lastName: alias.lastName };
    return this.person(`staff:${email || fallbackKey}`, hint);
  }

  staffEmail(realEmail: string | null | undefined, fallbackKey: string): string | null {
    const email = (realEmail ?? '').trim().toLowerCase();
    if (!email) return null;
    if (this.cfg.staff?.keep?.map((e) => e.toLowerCase()).includes(email)) return email;
    const alias = this.cfg.staff?.aliases?.[email];
    if (alias?.email) return alias.email;
    const name = this.staff(email, fallbackKey)!;
    return this.emailFor(name, `staff:${email}`);
  }

  /** Person key used to keep one real human on one fake identity across tables. */
  personKey(opts: { phone?: string | null; email?: string | null; id: string }): string {
    const p = this.canonicalPhone(opts.phone);
    if (p) return `phone:${p.e164Digits}`;
    const e = (opts.email ?? '').trim().toLowerCase();
    if (e && EMAIL_RE.test(e)) return `email:${e}`;
    return `id:${opts.id}`;
  }

  // ── phones ──

  /**
   * Parse any stored/typed phone style into its E.164 digit string plus the
   * style it was written in so the fake can be rendered the same way.
   */
  canonicalPhone(raw: string | null | undefined): {
    e164Digits: string;
    countryCallingCode: string;
    national: string;
    style: 'plus' | '00' | 'intl' | 'local0' | 'national' | 'formatted';
    formatted: string;
  } | null {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s || /[A-Za-z]/.test(s)) return null; // placeholders like "meta-<id>" / "MANUAL-x"
    const digitsOnly = s.replace(/\D/g, '');
    if (digitsOnly.length < 10 || digitsOnly.length > 15) return null;
    const defaultCountry = (this.cfg.defaultCountry ?? 'PK') as never;
    let parsed = parsePhoneNumberFromString(s, defaultCountry);
    if (!parsed && !s.startsWith('+')) {
      parsed = parsePhoneNumberFromString(`+${digitsOnly}`);
    }
    if (!parsed) return null;
    const cc = parsed.countryCallingCode;
    const national = parsed.nationalNumber;
    const e164Digits = `${cc}${national}`;
    const hasSeparators = /[\s\-.()]/.test(s);
    let style: 'plus' | '00' | 'intl' | 'local0' | 'national' | 'formatted';
    if (hasSeparators) style = 'formatted';
    else if (s.startsWith('+')) style = 'plus';
    else if (s.startsWith('00')) style = '00';
    else if (digitsOnly === e164Digits) style = 'intl';
    else if (digitsOnly === `0${national}`) style = 'local0';
    else style = 'national';
    return { e164Digits, countryCallingCode: cc, national, style, formatted: s };
  }

  /** Fake national number: keep the leading digit (mobile class), permute the rest. */
  private fakeNational(cc: string, national: string): string {
    if (national.length <= 2) return national;
    const keep = 1;
    const head = national.slice(0, keep);
    const tail = national.slice(keep);
    return head + this.permuteDigits(tail, `cc${cc}|${head}`);
  }

  /** E.164 digits without "+" (WhatsApp wa_id form) for any phone style. */
  waId(raw: string | null | undefined): string | null {
    const c = this.canonicalPhone(raw);
    if (!c) return raw ?? null;
    return `${c.countryCallingCode}${this.fakeNational(c.countryCallingCode, c.national)}`;
  }

  /** Masked phone rendered in the same style as the input. */
  phone(raw: string | null | undefined): string | null {
    if (raw == null) return raw ?? null;
    const c = this.canonicalPhone(raw);
    if (!c) {
      // Not a dialable number. Lettered placeholders ("meta-<id>",
      // "MANUAL-<ref>") carry no real digits and are kept verbatim so the
      // app's own placeholder logic keeps working; digit-only junk that the
      // parser rejected is hashed so no real digit run survives.
      const s = String(raw);
      if (/[A-Za-z]/.test(s)) return s;
      const d = s.replace(/\D/g, '');
      if (d.length >= 7) return `masked-${this.hex('junkphone', s, 10)}`;
      return s;
    }
    const fakeNat = this.fakeNational(c.countryCallingCode, c.national);
    const e164 = `+${c.countryCallingCode}${fakeNat}`;
    switch (c.style) {
      case 'plus':
        return e164;
      case '00':
        return `00${c.countryCallingCode}${fakeNat}`;
      case 'intl':
        return `${c.countryCallingCode}${fakeNat}`;
      case 'local0':
        return `0${fakeNat}`;
      case 'national':
        return fakeNat;
      case 'formatted': {
        // Re-flow the fake digits through the original separator layout.
        const rawDigits = c.formatted.replace(/\D/g, '');
        const fakeDigits = c.formatted.startsWith('00')
          ? `00${c.countryCallingCode}${fakeNat}`
          : c.formatted.startsWith('+') || rawDigits === c.e164Digits
            ? `${c.countryCallingCode}${fakeNat}`
            : rawDigits === `0${c.national}`
              ? `0${fakeNat}`
              : fakeNat;
        let i = 0;
        let out = '';
        for (const ch of c.formatted) {
          if (/\d/.test(ch)) {
            out += i < fakeDigits.length ? fakeDigits[i++] : '';
          } else out += ch;
        }
        // If the layout had fewer digit slots than we need, append the rest.
        if (i < fakeDigits.length) out += fakeDigits.slice(i);
        return out;
      }
    }
  }

  // ── emails / ids / dates / addresses ──

  emailFor(name: PersonName, key: string): string {
    const local = `${name.firstName}.${name.lastName}`.toLowerCase().replace(/[^a-z0-9.]/g, '');
    return `${local}.${this.hex('email', key, 6)}@${this.cfg.emailDomain}`;
  }

  /** Masked email for a given real email (deterministic, unique per real email). */
  email(raw: string | null | undefined, personKey?: string): string | null {
    if (!raw) return raw ?? null;
    const e = String(raw).trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return raw;
    if (e.endsWith(`@${this.cfg.emailDomain}`)) return e; // already masked
    const name = this.person(personKey ?? `email:${e}`);
    return this.emailFor(name, `email:${e}`);
  }

  passport(raw: string | null | undefined): string | null {
    if (!raw) return raw ?? null;
    return `P${this.digits('passport', String(raw), 7)}`;
  }

  cnic(raw: string | null | undefined): string | null {
    if (!raw) return raw ?? null;
    const d = this.digits('cnic', String(raw), 13);
    return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
  }

  nationalId(raw: string | null | undefined): string | null {
    if (!raw) return raw ?? null;
    return /^\d{5}-\d{7}-\d$/.test(String(raw)) ? this.cnic(raw) : `ID${this.digits('nid', String(raw), 9)}`;
  }

  /** Shift a date of birth by a deterministic −400…+400 days (keeps rough age). */
  dateOfBirth(raw: Date | string | null | undefined, key: string): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    const shift = this.int('dob', key, 801) - 400;
    return new Date(d.getTime() + shift * 86_400_000);
  }

  address(key: string): string {
    const house = this.int('house', key, 480) + 1;
    const street = this.pick('street', key, STREET_NAMES);
    const city = this.pick('city', key, CITIES);
    return `House ${house}, ${street}, ${city}`;
  }

  companyName(key: string): string {
    return `${this.pick('coA', key, COMPANY_WORDS_A)} ${this.pick('coB', key, COMPANY_WORDS_B)}`;
  }

  /** Opaque replacement for secrets / tokens / signatures. */
  secret(kind: string, raw: string | null | undefined): string | null {
    if (!raw) return raw ?? null;
    return `demo-${kind}-${this.hex(`secret:${kind}`, String(raw), 24)}`;
  }

  /** Marker stored instead of any media key / URL. The UI renders a placeholder. */
  static readonly MEDIA_PLACEHOLDER = 'demo:placeholder';

  // ── free text ──

  /**
   * Scrub free text: thread-specific name aliases → brand tokens → emails →
   * CNICs → phones → wamids. Idempotent: scrubbing already-scrubbed text
   * yields the same text.
   */
  scrubText(text: string | null | undefined, ctx?: ScrubContext): string | null {
    if (text == null) return text ?? null;
    let s = String(text);
    if (!s) return s;

    // Emails first so a brand domain inside an address is masked as an address.
    s = s.replace(EMAIL_RE, (m) => this.email(m) ?? m);
    // Full "First Last" names next (most specific), then brand tokens, then
    // single name tokens — so a staff member whose first name is also the
    // brand ("Tashfeen Sohail" at "Tashfeen Immigration") resolves correctly.
    if (ctx?.names?.length) s = this.replaceNames(s, ctx.names, 'full');
    if (this.brandRe) s = s.replace(this.brandRe, (m) => (m.length <= 9 && this.cfg.brandShort ? this.cfg.brandShort : this.cfg.brandName));
    if (ctx?.names?.length) s = this.replaceNames(s, ctx.names, 'tokens');
    if (ctx?.nameIndex?.size) s = this.replaceIndexedNames(s, ctx.nameIndex);
    // Catch-all for the tenant name in any other form (domains such as
    // www.tashfeenimmigrationsolutions.com, glued words, handles): nothing
    // containing a brand stem may survive.
    for (const stem of this.brandStems) {
      s = s.replace(new RegExp(`[\\w.-]*${escapeRe(stem)}[\\w-]*(?:\\.[a-z]{2,})+`, 'gi'), this.cfg.emailDomain);
      s = s.replace(new RegExp(escapeRe(stem), 'gi'), (m) => matchCase(m, this.brandWord));
    }
    // Real office landmarks the tenant's staff and bot quote in chats.
    for (const [re, to] of OFFICE_TOKENS) s = s.replace(re, to);
    s = s.replace(CNIC_RE, (m) => this.cnic(m) ?? m);
    s = s.replace(PHONE_RE, (m) => {
      const masked = this.phone(m);
      return masked ?? m;
    });
    s = s.replace(WAMID_RE, (m) => `wamid.demo${this.hex('wamid', m, 24)}`);
    return s;
  }

  private replaceNames(s: string, aliases: NameAlias[], phase: 'full' | 'tokens'): string {
    // Longest real tokens first so "Muhammad Ali Khan" wins over "Ali".
    const pairs: Array<[string, string]> = [];
    for (const a of aliases) {
      const rf = a.real.firstName?.trim();
      const rl = a.real.lastName?.trim();
      const ff = a.fake.firstName;
      const fl = a.fake.lastName;
      const firstParts = (rf ?? '').split(/\s+/).filter(Boolean);
      if (phase === 'full') {
        if (rf && rl) pairs.push([`${rf} ${rl}`, `${ff} ${fl}`]);
        // "Muhammad Ali Qadri" is also written "Ali Qadri" / "Muhammad Qadri".
        if (firstParts.length > 1 && rl) {
          for (const part of firstParts) if (part.length >= 2) pairs.push([`${part} ${rl}`, `${ff} ${fl}`]);
        }
        continue;
      }
      if (rf && rf.length >= 3) pairs.push([rf, ff]);
      if (rl && rl.length >= 3) pairs.push([rl, fl]);
      // Multi-word first names ("Muhammad Ali"): alias each part too. Inside
      // the person's own thread even a 3-letter token ("Ali") is their name.
      for (const part of firstParts) {
        if (part.length >= 3 && part !== rf) pairs.push([part, ff]);
      }
    }
    pairs.sort((a, b) => b[0].length - a[0].length);
    for (const [real, fake] of pairs) {
      const re = new RegExp(`(?<![A-Za-z])${escapeRe(real)}(?![A-Za-z])`, 'gi');
      s = s.replace(re, (m) => matchCase(m, fake));
    }
    return s;
  }

  /**
   * Replace every 2- or 3-word span whose normalised form is a known real
   * person's full name. O(len): tokens are scanned once, longest match first.
   */
  private replaceIndexedNames(s: string, index: Map<string, PersonName>): string {
    const tokens: Array<{ start: number; end: number; norm: string }> = [];
    const re = /[A-Za-z\u0600-\u06FF]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) tokens.push({ start: m.index, end: m.index + m[0].length, norm: m[0].toLowerCase() });
    if (tokens.length < 2) return s;
    const edits: Array<{ start: number; end: number; text: string }> = [];
    let i = 0;
    while (i + 1 < tokens.length) {
      let hit: PersonName | undefined;
      let span = 0;
      if (i + 2 < tokens.length) {
        hit = index.get(`${tokens[i].norm} ${tokens[i + 1].norm} ${tokens[i + 2].norm}`);
        if (hit) span = 3;
      }
      if (!hit) {
        hit = index.get(`${tokens[i].norm} ${tokens[i + 1].norm}`);
        if (hit) span = 2;
      }
      if (hit) {
        const start = tokens[i].start;
        const end = tokens[i + span - 1].end;
        edits.push({ start, end, text: matchCase(s.slice(start, end), `${hit.firstName} ${hit.lastName}`) });
        i += span;
      } else {
        i += 1;
      }
    }
    if (!edits.length) return s;
    let out = '';
    let pos = 0;
    for (const e of edits) {
      out += s.slice(pos, e.start) + e.text;
      pos = e.end;
    }
    return out + s.slice(pos);
  }

  /** Deep-scrub every string inside a JSON value. Keys are preserved. */
  scrubJson<T>(value: T, ctx?: ScrubContext): T {
    if (value == null) return value;
    if (typeof value === 'string') return this.scrubText(value, ctx) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.scrubJson(v, ctx)) as unknown as T;
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.scrubJson(v, ctx);
      }
      return out as T;
    }
    return value;
  }

  /**
   * Meta message payload: strip media ids, replace the sender profile name,
   * keep captions/transcripts (scrubbed) so the inbox still reads naturally.
   */
  scrubMessagePayload(payload: unknown, ctx?: ScrubContext & { fakeProfileName?: string }): unknown {
    if (!payload || typeof payload !== 'object') return this.scrubJson(payload, ctx);
    const p = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    for (const mediaKey of ['image', 'video', 'audio', 'document', 'sticker', 'voice']) {
      const m = p[mediaKey];
      if (m && typeof m === 'object') {
        const mm = m as Record<string, unknown>;
        p[mediaKey] = {
          demoPlaceholder: true,
          ...(typeof mm.mime_type === 'string' ? { mime_type: mm.mime_type } : {}),
          ...(typeof mm.caption === 'string' ? { caption: mm.caption } : {}),
          ...(typeof mm.filename === 'string' ? { filename: this.fileName(mm.filename) } : {}),
          ...(typeof mm.voice === 'boolean' ? { voice: mm.voice } : {}),
        };
      }
    }
    if (p.contacts && Array.isArray(p.contacts)) {
      p.contacts = (p.contacts as Array<Record<string, unknown>>).map((c) => {
        const prof = (c.profile && typeof c.profile === 'object') ? { ...(c.profile as Record<string, unknown>) } : undefined;
        if (prof && typeof prof.name === 'string') prof.name = ctx?.fakeProfileName ?? this.person(`profile:${prof.name}`).firstName;
        return { ...c, ...(prof ? { profile: prof } : {}) };
      });
    }
    if (typeof p.profileName === 'string') p.profileName = ctx?.fakeProfileName ?? this.person(`profile:${p.profileName}`).firstName;
    if (p.location && typeof p.location === 'object') {
      p.location = { demoPlaceholder: true, name: 'Shared location' };
    }
    return this.scrubJson(p, ctx);
  }

  /**
   * Meta click-to-WhatsApp referral object: keep the ad copy (it is the
   * tenant's own marketing), replace every identifier / media URL.
   */
  scrubAdReferral(value: unknown, ctx?: ScrubContext): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return this.scrubJson(value, ctx);
    const v = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(v)) {
      if (raw == null) continue;
      if (/^(ctwa_clid|source_id|ad_id|adset_id|campaign_id|form_id|leadgen_id)$/i.test(k)) {
        out[k] = `demo${this.hex(`adref:${k}`, String(raw), 16)}`;
      } else if (/url$/i.test(k) || /^(image|video|thumbnail)/i.test(k)) {
        // Drop media URLs entirely: a marker here would end up in an <img src>.
        continue;
      } else {
        out[k] = this.scrubJson(raw, ctx);
      }
    }
    return out;
  }

  /** Keep the extension, hide the name ("passport_ali.pdf" → "document-ab12cd.pdf"). */
  fileName(raw: string | null | undefined): string | null {
    if (!raw) return raw ?? null;
    const m = /\.([A-Za-z0-9]{1,6})$/.exec(String(raw));
    const ext = m ? `.${m[1].toLowerCase()}` : '';
    return `document-${this.hex('file', String(raw), 6)}${ext}`;
  }
}

function matchCase(sample: string, replacement: string): string {
  if (sample === sample.toUpperCase() && sample.length > 1) return replacement.toUpperCase();
  if (sample === sample.toLowerCase()) return replacement.toLowerCase();
  return replacement;
}

/** Build a masker from env (shared by the Nest service, the CLI and the leak check). */
export function maskerFromEnv(env: NodeJS.ProcessEnv = process.env): DemoMasker {
  const salt = env.DEMO_MASK_SALT;
  if (!salt) throw new Error('DEMO_MASK_SALT is not set');
  let staff: MaskingConfig['staff'];
  if (env.DEMO_STAFF_KEEP || env.DEMO_STAFF_ALIASES) {
    staff = {
      keep: (env.DEMO_STAFF_KEEP ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      aliases: env.DEMO_STAFF_ALIASES ? (JSON.parse(env.DEMO_STAFF_ALIASES) as Record<string, StaffAlias>) : undefined,
    };
  }
  return new DemoMasker({
    salt,
    brandName: env.DEMO_BRAND_NAME ?? DEFAULT_MASKING_CONFIG.brandName,
    brandShort: env.DEMO_BRAND_SHORT ?? DEFAULT_MASKING_CONFIG.brandShort,
    emailDomain: env.DEMO_EMAIL_DOMAIN ?? DEFAULT_MASKING_CONFIG.emailDomain,
    brandTokens: env.DEMO_BRAND_TOKENS
      ? env.DEMO_BRAND_TOKENS.split('|').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_MASKING_CONFIG.brandTokens,
    defaultCountry: env.DEMO_DEFAULT_COUNTRY ?? DEFAULT_MASKING_CONFIG.defaultCountry,
    staff,
  });
}
