/**
 * Per-service "sub-stage" picklists (feedback F3).
 *
 * A sub-stage is a LIGHTWEIGHT, editable tracking label an officer sets on a
 * case to communicate where inside the current phase the work sits (e.g. "Doc
 * collection", "Final submission under process"). It is display-only: it never
 * drives the ProcessingCaseStage state machine, document gates, SLA, or
 * reporting — those are all owned by `stage`.
 *
 * The feedback specified picklists for exactly two flows (Visit Visa and the
 * LMIA-exempt Work Permit). For EVERY OTHER service the field is free-text —
 * the officer types the label manually (or leaves it blank), per the doc's
 * "leave it blank or leave space for manual entry". Mirror of the frontend
 * `lib/processing-substages.ts` — keep the two in sync by hand.
 */

export const CATEGORY_SUBSTAGE: Readonly<Record<string, readonly string[]>> = {
  VISIT_VISA: ['Doc collection', 'Hold', 'Final submission under process', 'Submission done', 'Decision'],
  // The "LMIA-exempt work permit" flow the processing team described.
  WORK_PERMIT: ['Business meeting & profile assessment', 'Business establishment', 'Exemption', 'Doc collection', 'Final submission', 'Decision'],
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
 * Validate a proposed sub-stage value for a service. Services WITH a picklist
 * must pick a member; services WITHOUT one accept any string (manual entry —
 * the DTO already bounds the length).
 */
export function isValidSubStage(service: string, value: string): boolean {
  const list = CATEGORY_SUBSTAGE[service];
  if (list && list.length > 0) return list.includes(value);
  return true;
}
