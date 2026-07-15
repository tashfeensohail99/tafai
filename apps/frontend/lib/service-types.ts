/**
 * Canonical list of service types a Lead can be classified as. Single source
 * of truth for every UI surface that picks or displays the service.
 *
 * Why coded: stored as the `code` string in `Lead.serviceInterest`, then mapped
 * to the human label for display. The codes match the case types in the
 * Processing Department workflow document, so a downstream `ChecklistTemplate`
 * can lookup the per-service document requirements by code with no fuzzy
 * matching.
 *
 * Legacy compatibility: leads created before this list existed have free-text
 * `serviceInterest` (e.g. "Study Visa"). `labelForServiceCode` falls back to
 * returning the raw value so they keep rendering until Sales reclassifies the
 * lead on the next edit.
 */

export interface ServiceTypeOption {
  /** Stable identifier persisted in `Lead.serviceInterest`. */
  code: string;
  /** Human-facing label used everywhere we render the service. */
  label: string;
  /** Short tagline shown under the label on the chip picker. */
  caption?: string;
  /** Legacy/retired: still a valid stored code (so existing rows keep rendering
   *  and pass @IsIn validation) but hidden from NEW pickers. See
   *  PICKABLE_SERVICE_TYPES. */
  hidden?: boolean;
}

export const SERVICE_TYPES: ServiceTypeOption[] = [
  { code: 'STUDY_VISA',      label: 'Study Visa',                 caption: 'Student admission + visa' },
  { code: 'WORK_PERMIT',     label: 'Work Permit (WP)',           caption: 'LMIA / exemption based' },
  { code: 'PR_CASE',         label: 'Permanent Residency (PR)',   caption: 'Federal / provincial' },
  { code: 'VISIT_VISA',      label: 'Visit Visa',                 caption: 'Family / business visit' },
  // Tourist Visa retired from the pickers per processing-team feedback; kept
  // here as a valid legacy code so any existing lead/case still renders + validates.
  { code: 'TOURIST_VISA',    label: 'Tourist Visa',               caption: 'Short stay leisure', hidden: true },
  { code: 'SPOUSE_VISA',     label: 'Spouse Visa',                caption: 'Family sponsorship' },
  { code: 'E2_VISA',         label: 'E2 Visa',                    caption: 'Investor / treaty' },
  { code: 'CBI',             label: 'Citizenship by Investment',  caption: 'CBI programs' },
  { code: 'JR_RESUBMISSION', label: 'JR Resubmission',            caption: 'Refused case rework' },
];

/** Service types offered in NEW pickers/dropdowns (excludes hidden/legacy ones
 *  like Tourist Visa). Use this for any "choose a service" UI; use SERVICE_TYPES
 *  only for label lookup / validation over historical data. */
export const PICKABLE_SERVICE_TYPES: ServiceTypeOption[] = SERVICE_TYPES.filter(
  (s) => !s.hidden,
);

/** Just the codes — useful for class-validator @IsIn() on the backend. */
export const SERVICE_TYPE_CODES: string[] = SERVICE_TYPES.map((s) => s.code);

/** Set form for fast membership checks. */
export const SERVICE_TYPE_CODE_SET: ReadonlySet<string> = new Set(SERVICE_TYPE_CODES);

/**
 * Map a stored value to its display label. Returns the raw input when the
 * value isn't a canonical code (legacy free-text leads) so existing rows
 * keep rendering until Sales reclassifies. Empty / null → "—".
 */
export function labelForServiceCode(value: string | null | undefined): string {
  if (!value || !value.trim()) return '—';
  const hit = SERVICE_TYPES.find((s) => s.code === value);
  return hit ? hit.label : value;
}

/** True if the stored value is a canonical code (vs. legacy free text). */
export function isCanonicalServiceCode(value: string | null | undefined): boolean {
  return !!value && SERVICE_TYPE_CODE_SET.has(value);
}
