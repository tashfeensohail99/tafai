/**
 * Per-service "case stage" picklists — the processing team's workflow labels
 * (Suggested Interface, 2026-09-17), split by case type. Frontend mirror of the
 * backend `substage-templates.ts`; keep the two in sync BY HAND (same pattern as
 * lib/service-types.ts) or the backend validator will reject a value this
 * dropdown offers.
 *
 * These are the team's day-to-day labels on `ProcessingCase.subStage`, alongside
 * the real ProcessingCaseStage state machine. A few drive REAL actions via
 * `subStageAction()` (Submitted → Change Stage flow, Closed → Close flow); Hold
 * and Refund render as real badges. The rest are tracking labels.
 */

export const OTHER_SUBSTAGE = 'Other (manual entry)';

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
];

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
];

export const CATEGORY_SUBSTAGE: Record<string, string[]> = {
  VISIT_VISA: VISIT_LIST,
  WORK_PERMIT: BUSINESS_LIST,
  E2_VISA: BUSINESS_LIST,
  CBI: BUSINESS_LIST,
};

/** The sub-stage picklist for a service code, or [] when it is free-text. */
export function subStagesForService(service: string): string[] {
  return CATEGORY_SUBSTAGE[service] ?? [];
}

/** True when the service has a fixed picklist (render a dropdown); false =
 *  free-text manual entry. */
export function hasSubStageList(service: string): boolean {
  return (CATEGORY_SUBSTAGE[service]?.length ?? 0) > 0;
}

/** The "Other (manual entry)" escape hatch — reveal a free-text box. */
export function isOtherSubStage(value: string | null | undefined): boolean {
  return value === OTHER_SUBSTAGE;
}

/**
 * A picked label that should launch a REAL, validated case action instead of
 * being a plain tracking label:
 *  - 'submit' → open the Change-Stage flow (officer confirms SUBMITTED + ref)
 *  - 'close'  → open the Close/Complete flow (officer confirms + notes)
 * Everything else returns null (it's a tracking label). JR is intentionally a
 * tracking label — the real JR hand-off is its own gated flow (a case must be
 * refused first), so this never auto-escalates.
 */
export function subStageAction(value: string | null | undefined): 'submit' | 'close' | null {
  if (value === 'Submitted') return 'submit';
  if (value === 'Closed') return 'close';
  return null;
}

/** Hold label → the case is parked (shown as an "On hold" badge). */
export function isHoldSubStage(value: string | null | undefined): boolean {
  return value === 'Hold';
}

/** Refund label → records that a refund was requested (badge only — it does NOT
 *  move any money). */
export function isRefundSubStage(value: string | null | undefined): boolean {
  return value === 'Refund';
}
