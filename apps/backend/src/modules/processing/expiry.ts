/**
 * Validity-expiry derivation (Phase 4b). Pure + side-effect free.
 *
 * The submission gate already refuses to file a case when a required document's
 * `validityExpiryDate` is in the past — but that column was never written, so
 * the check was inert. This computes the expiry the moment a document is
 * accepted, from the parser's extracted fields + the slot's validity rule, so
 * the gate bites and the checklist can warn before a doc lapses.
 */

export interface ExpiryRuleInput {
  /** NONE | MUST_NOT_EXPIRE | MUST_BE_VALID_FOR_N_MONTHS */
  validityRule: string | null;
  validityMonths: number | null;
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : null;
  }
  return null;
}

function mk(y: number, mon1: number, day: number): Date | null {
  if (!y || !mon1 || !day || mon1 > 12 || day > 31) return null;
  const d = new Date(Date.UTC(y, mon1 - 1, day));
  return isNaN(d.getTime()) ? null : d;
}

/** Lenient parse to a UTC-midnight Date (ISO, DD/MM/YYYY, DD-MM-YYYY, …) or null. */
export function parseLooseDate(s: string | null): Date | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // YYYY-MM-DD
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); // DD-MM-YYYY (ambiguous → lenient)
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const day = a > 12 ? a : b > 12 ? b : a;
    const mon = a > 12 ? b : a;
    return mk(+m[3], mon, day);
  }
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Derive when an accepted document lapses:
 *   1. an explicit extracted expiry / valid-until (passport, visa, many PCCs), else
 *   2. issuance date + validityMonths (docs "valid N months from issue" — PCC,
 *      medical, language) when the slot carries a validityMonths window.
 * Returns null when no expiry can be derived (the doc simply isn't expiry-tracked).
 */
export function computeValidityExpiry(
  rule: ExpiryRuleInput,
  extracted: Record<string, unknown> | null | undefined,
): Date | null {
  const e = extracted ?? {};
  const explicit = parseLooseDate(
    asString(e.expiryDate) ?? asString(e.validUntil) ?? asString(e.dateOfExpiry),
  );
  if (explicit) return explicit;

  if (rule.validityMonths && rule.validityMonths > 0) {
    const issued = parseLooseDate(
      asString(e.documentDate) ??
        asString(e.statementDate) ??
        asString(e.issueDate) ??
        asString(e.dateOfIssue),
    );
    if (issued) {
      const d = new Date(issued);
      d.setUTCMonth(d.getUTCMonth() + rule.validityMonths);
      return d;
    }
  }
  return null;
}
