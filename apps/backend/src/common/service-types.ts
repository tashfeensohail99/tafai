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

/**
 * Agreement-template category (`finance.agreement_templates.categoryKey`) → the
 * canonical service code it represents. The template is what the customer
 * ACTUALLY signed, so routing (JR vs Processing) and the processing case's
 * service should derive from THIS — not from `Lead.serviceInterest`, which is a
 * single mutable tag that goes stale when a returning client buys a different
 * service than their lead was first classified as. Unmapped categories fall back
 * to the lead tag at the call site.
 */
export const TEMPLATE_CATEGORY_TO_SERVICE: Readonly<Record<string, ServiceTypeCode>> = {
  JR: 'JR_RESUBMISSION',
  VISIT_VISA: 'VISIT_VISA',
  C11: 'WORK_PERMIT',
  C10: 'WORK_PERMIT',
  E2: 'E2_VISA',
  EB2_NIW: 'PR_CASE',
  FINLAND_STARTUP: 'WORK_PERMIT',
};

/** Canonical service for a template category, or null when the category is
 *  unknown/unmapped (caller then falls back to the lead's serviceInterest). */
export function serviceForTemplateCategory(categoryKey: string | null | undefined): ServiceTypeCode | null {
  return (categoryKey && TEMPLATE_CATEGORY_TO_SERVICE[categoryKey]) || null;
}
