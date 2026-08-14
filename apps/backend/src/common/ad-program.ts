/**
 * Classify a Meta ad / campaign NAME into the immigration program it advertises.
 *
 * Tashfeen's Click-to-WhatsApp ad names embed the program, e.g.
 *   "Faizan2 c11 whatsapp message"      → C11
 *   "Faizan1 C-11 WhatsApp Advantage+"  → C11
 *   "Faizan2 JR whatsapp message"       → JR
 *   "Visit visa Canada Whatsapp"        → VISIT_VISA
 *   "Faizan C10 Whatsapp"               → C10
 * Organic posts / website promos ("Post: …", "Promoting Website") carry no
 * program token → OTHER. We classify from the NAME only (there is no program
 * field on the ad models), so an ambiguous name falls to OTHER rather than
 * being silently mis-bucketed.
 */
export type AdProgram = 'C11' | 'JR' | 'VISIT_VISA' | 'C10' | 'RCIP' | 'OTHER';

export const AD_PROGRAM_ORDER: AdProgram[] = ['C11', 'JR', 'VISIT_VISA', 'C10', 'RCIP', 'OTHER'];

export const AD_PROGRAM_LABEL: Record<AdProgram, string> = {
  C11: 'C11 · Work Permit',
  JR: 'JR · Resubmission',
  VISIT_VISA: 'Visit Visa',
  C10: 'C10 · Work Permit',
  RCIP: 'RCIP',
  OTHER: 'Other / uncategorized',
};

/**
 * Classify from one or more name strings (ad name first, campaign name as a
 * fallback). More specific / less ambiguous tokens are checked first.
 */
export function classifyAdProgram(...names: Array<string | null | undefined>): AdProgram {
  const hay = names.filter(Boolean).join(' ').toLowerCase();
  if (!hay) return 'OTHER';
  if (/\bc[-\s]?11\b/.test(hay)) return 'C11';
  if (/\bc[-\s]?10\b/.test(hay)) return 'C10';
  if (/\brcip\b/.test(hay)) return 'RCIP';
  if (/\bvisit\b/.test(hay)) return 'VISIT_VISA';
  if (/\bjr\b/.test(hay) || /judicial\s*review/.test(hay)) return 'JR';
  return 'OTHER';
}
