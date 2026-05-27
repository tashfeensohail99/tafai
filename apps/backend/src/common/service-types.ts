/**
 * Canonical service-type codes a Lead can be classified as.
 *
 * Mirrors `apps/frontend/lib/service-types.ts` — kept in sync manually
 * because the backend and frontend packages don't share a runtime
 * dependency. If you add a code here, also add the matching entry on
 * the frontend with its display label + caption.
 *
 * Codes are stored in `Lead.serviceInterest` (still a free-text column
 * to preserve legacy data). The API and the Sales→Finance gate validate
 * against this set so new writes are constrained.
 */
export const SERVICE_TYPE_CODES = [
  'STUDY_VISA',
  'WORK_PERMIT',
  'PR_CASE',
  'VISIT_VISA',
  'TOURIST_VISA',
  'SPOUSE_VISA',
  'E2_VISA',
  'CBI',
  'JR_RESUBMISSION',
] as const;

export type ServiceTypeCode = (typeof SERVICE_TYPE_CODES)[number];

export const SERVICE_TYPE_CODE_SET: ReadonlySet<string> = new Set(SERVICE_TYPE_CODES);

export function isCanonicalServiceCode(value: string | null | undefined): boolean {
  return !!value && SERVICE_TYPE_CODE_SET.has(value);
}
