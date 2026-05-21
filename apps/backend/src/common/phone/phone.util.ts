import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Normalise a free-form phone string to E.164 (e.g. "+923331120001").
 *
 * Accepts whatever the user typed or whatever a spreadsheet contained:
 *   "0333 112 0001"        → "+923331120001"
 *   "03331120001"          → "+923331120001"     (with defaultCountry='PK')
 *   "+92 333 112 0001"     → "+923331120001"
 *   "923331120001"         → "+923331120001"
 *   "0333-112-0001 ext.5"  → "+923331120001"
 *   "rubbish"              → { ok: false }
 *
 * The defaultCountry is the ISO 3166-1 alpha-2 code used when the input
 * has no international prefix. For Tashfeen's Pakistan-based ad lists that's
 * "PK"; admin can override per upload-batch in case a list mixes origins.
 *
 * libphonenumber-js validates against Google's libphonenumber metadata,
 * which is what WhatsApp, Twilio, and most carriers use — so a number
 * that passes here is the same number Meta will accept on `to` field
 * sends.
 */
export interface NormalisedPhone {
  ok: boolean;
  /** E.164 form when ok=true; undefined when ok=false. */
  e164?: string;
  /** ISO country code resolved from the prefix (or defaultCountry fallback). */
  country?: string;
  /** Human-readable reason when ok=false. */
  reason?: string;
}

export function normalisePhone(
  input: string | null | undefined,
  defaultCountry: CountryCode = 'PK',
): NormalisedPhone {
  if (!input || typeof input !== 'string') {
    return { ok: false, reason: 'empty' };
  }

  // Strip common spreadsheet noise:
  //   "tel:"   — clickable-link prefix Excel sometimes adds
  //   "p:"     — Meta Lead Ads / Facebook form export prefix (every phone
  //              in a Meta export comes as "p:+923331120001")
  //   trailing "ext. NNN" — Outlook contact dumps
  //   leading quote — Excel-as-text artefact on numeric cells
  //   zero-width whitespace — copy-paste from web pages
  let trimmed = input
    .trim()
    .replace(/^['"`]+/, '')
    .replace(/^(tel|p):\s*/i, '')
    .replace(/\s+ext\.?\s*\d+$/i, '')
    .replace(/[​-‏﻿]/g, '');

  if (!trimmed) {
    return { ok: false, reason: 'empty after cleanup' };
  }

  // Common Excel artefact: numbers stored as scientific notation (e.g.
  // "9.23331E+11"). Try to expand before parsing.
  if (/e\+?\d+/i.test(trimmed) && !trimmed.startsWith('+')) {
    const n = Number(trimmed);
    if (Number.isFinite(n) && n > 0) trimmed = String(Math.round(n));
  }

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed) {
    return { ok: false, reason: 'unparseable' };
  }
  if (!parsed.isValid()) {
    return { ok: false, reason: 'invalid for region' };
  }
  return {
    ok: true,
    e164: parsed.number,
    country: parsed.country,
  };
}
