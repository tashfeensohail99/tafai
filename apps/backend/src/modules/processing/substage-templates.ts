/**
 * Per-service "case stage" picklists — the processing team's own workflow
 * labels (Suggested Interface, 2026-09-17), split by case type.
 *
 * Stored on `ProcessingCase.subStage`. These are the team's day-to-day tracking
 * labels; they sit ALONGSIDE the real `ProcessingCaseStage` state machine (which
 * owns document gates, SLA and reporting) rather than replacing it. A few labels
 * are wired to REAL actions in the UI — picking "Submitted" launches the
 * validated Change-Stage flow, "Closed" launches the Close flow — and "Hold" /
 * "Refund" surface as real badges (Hold shows the case is parked; Refund records
 * a request only, it never triggers the finance refund engine). The rest are
 * tracking labels. Mirror of the frontend `lib/processing-substages.ts` — keep
 * the two in sync by hand.
 */

/** Selecting this reveals a free-text box — any label the officer types is then
 *  accepted for that service (see isValidSubStage). Keep identical to the
 *  frontend mirror. */
export const OTHER_SUBSTAGE = 'Other (manual entry)';

// Visit-visa flow.
const VISIT_LIST = [
  'Consultation & profile assessment',
  'Documents collection',
  'Submitted',
  'JR',
  'Resubmission',
  'Escalation',
  'Closed',
  'Hold',
  OTHER_SUBSTAGE,
] as const;

// Business / investment flow ("C11" on the mockup) — Work Permit + investor
// programs.
const BUSINESS_LIST = [
  'Consultation & profile assessment',
  'Business development',
  'IT work',
  'Investment approval',
  'Exemption',
  'Document collection',
  'Submitted',
  'JR',
  'Resubmission',
  'Refund',
  'Escalation Department',
  'Hold',
  OTHER_SUBSTAGE,
] as const;

export const CATEGORY_SUBSTAGE: Readonly<Record<string, readonly string[]>> = {
  VISIT_VISA: VISIT_LIST,
  WORK_PERMIT: BUSINESS_LIST,
  E2_VISA: BUSINESS_LIST,
  CBI: BUSINESS_LIST,
};

/** The sub-stage picklist for a service code, or [] when the service is
 *  free-text (manual entry). */
export function subStagesForService(service: string): readonly string[] {
  return CATEGORY_SUBSTAGE[service] ?? [];
}

/** True when the service has a fixed picklist (dropdown), false when it is
 *  free-text / manual entry. */
export function hasSubStageList(service: string): boolean {
  return (CATEGORY_SUBSTAGE[service]?.length ?? 0) > 0;
}

/**
 * Validate a proposed sub-stage value for a service.
 * - Service WITH a picklist that INCLUDES "Other (manual entry)": a list member
 *   OR any (length-bounded) free-text value the officer typed under "Other".
 * - Service WITH a picklist WITHOUT an "Other" escape: must pick a member.
 * - Service WITHOUT a picklist: any string (manual entry).
 */
export function isValidSubStage(service: string, value: string): boolean {
  const list = CATEGORY_SUBSTAGE[service];
  if (list && list.length > 0) {
    if (list.includes(value)) return true;
    return list.includes(OTHER_SUBSTAGE);
  }
  return true;
}
