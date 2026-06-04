/**
 * Bridge between the parser's classification vocab and the checklist's slot
 * vocab.
 *
 * The Python parser classifies into its own canonical DOC_TYPES (PASSPORT,
 * EMPLOYMENT_LETTER, MEDICAL_EXAM, …). The processing checklist's
 * CaseDocumentItem.docType strings are seeded from a different, more
 * program-specific vocab (EMPLOYER_LETTER, MEDICAL_REPORT, EDUCATIONAL_DOCUMENT,
 * …). Without a bridge, a detected "EMPLOYMENT_LETTER" never matches an
 * "EMPLOYER_LETTER" slot, so the triage tray can't suggest where it belongs.
 *
 * This map is advisory only — it drives a *suggestion* the human confirms; it
 * never auto-files. So a reasonable-but-inexact mapping (RESUME -> work history)
 * is fine: worst case the associate picks a different slot.
 *
 * Candidates are listed best-first. matchItem tries the raw detected type first
 * (covers templates that happen to use parser vocab), then these in order.
 */
const PARSER_TO_SLOT: Record<string, string[]> = {
  // Exact / near-exact equivalences ------------------------------------------
  PASSPORT: ['PASSPORT'],
  PHOTOGRAPH: ['PHOTOGRAPH'],
  BANK_STATEMENT: ['BANK_STATEMENT', 'FINANCIALS'],
  TAX_RETURN: ['FINANCIALS', 'BANK_STATEMENT'],
  ACADEMIC_TRANSCRIPT: ['EDUCATIONAL_DOCUMENT'],
  EDUCATION_CERTIFICATE: ['EDUCATIONAL_DOCUMENT'],
  POLICE_CLEARANCE: ['POLICE_CHARACTER_CERTIFICATE'],
  MEDICAL_EXAM: ['MEDICAL_REPORT'],
  LMIA: ['LMIA_DECISION'],
  BUSINESS_PLAN: ['BUSINESS_PLAN'],
  INCORPORATION: ['INCORPORATION', 'CORP_LEGITIMACY'],
  TRAVEL_ITINERARY: ['ITINERARY'],
  // Reasonable suggestions (human confirms) ----------------------------------
  EMPLOYMENT_LETTER: ['EMPLOYER_LETTER', 'EXPERIENCE_LETTER', 'OFFER_OF_EMPLOYMENT', 'JOB_OFFER'],
  RESUME: ['EXPERIENCE_LETTER'],
  STATEMENT_OF_PURPOSE: ['COVER_LETTER'],
  SPONSORSHIP_LETTER: ['INVITATION'],
  MARRIAGE_CERTIFICATE: ['TIES_PROOF'],
  BIRTH_CERTIFICATE: ['TIES_PROOF'],
  // No slot in the currently-seeded services -> no suggestion (human files):
  //   NATIONAL_ID, LANGUAGE_TEST, ACCEPTANCE_LETTER, VISA, OTHER
};

// Acronyms that should stay upper-cased in a human label (rather than "Id").
const DOCTYPE_ACRONYMS = new Set(['ID', 'LMIA', 'CNIC', 'SOP', 'NICOP', 'NTN', 'IELTS', 'PTE', 'GIC']);

/**
 * Human-friendly label for a parser/slot docType code, e.g.
 * BANK_STATEMENT -> "Bank Statement", NATIONAL_ID -> "National ID".
 * Falls back to title-casing any unknown snake_case code. Returns '' for empty.
 */
export function humanizeDocType(code: string | null | undefined): string {
  if (!code) return '';
  return code
    .trim()
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => (DOCTYPE_ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Ordered slot-docType candidates for a parser-detected type, best-first.
 * Always includes the raw detected value first so an exact-vocab match wins.
 */
export function parserDocTypeCandidates(detected: string | null | undefined): string[] {
  if (!detected) return [];
  const raw = detected.trim().toUpperCase();
  if (!raw) return [];
  const mapped = PARSER_TO_SLOT[raw] ?? [];
  const out: string[] = [];
  for (const t of [raw, ...mapped]) {
    if (!out.includes(t)) out.push(t);
  }
  return out;
}
