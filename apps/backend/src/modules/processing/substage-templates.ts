/**
 * Per-service "sub-stage" picklists (feedback F3).
 *
 * A sub-stage is a LIGHTWEIGHT, editable tracking label an officer sets on a
 * case to communicate where inside the current phase the work sits (e.g. "Doc
 * collection", "Final submission under process"). It is display-only: it never
 * drives the ProcessingCaseStage state machine, document gates, SLA, or
 * reporting — those are all owned by `stage`.
 *
 * Keyed by canonical service code (see common/service-types.ts). A code without
 * a specific list falls back to DEFAULT_SUBSTAGES. Mirror of the frontend
 * `lib/processing-substages.ts` — keep the two in sync by hand, exactly like
 * service-types.ts is mirrored.
 */

export const DEFAULT_SUBSTAGES: readonly string[] = [
  'Doc collection',
  'Hold',
  'Final submission under process',
  'Submission done',
  'Decision',
];

export const CATEGORY_SUBSTAGE: Readonly<Record<string, readonly string[]>> = {
  STUDY_VISA: ['Profile assessment', 'Admission / offer', 'Doc collection', 'Final submission under process', 'Submission done', 'Decision'],
  // The "LMIA-exempt work permit" flow the processing team described.
  WORK_PERMIT: ['Business meeting & profile assessment', 'Business establishment', 'Exemption', 'Doc collection', 'Final submission', 'Decision'],
  PR_CASE: ['Profile assessment', 'Pool / EOI entry', 'Doc collection', 'Final submission under process', 'Submission done', 'Decision'],
  VISIT_VISA: ['Doc collection', 'Hold', 'Final submission under process', 'Submission done', 'Decision'],
  // TOURIST_VISA is hidden from new-case pickers but still a valid stored code,
  // so a legacy tourist-visa case still renders + validates a sub-stage.
  TOURIST_VISA: ['Doc collection', 'Hold', 'Final submission under process', 'Submission done', 'Decision'],
  SPOUSE_VISA: ['Relationship evidence', 'Doc collection', 'Sponsor verification', 'Final submission under process', 'Submission done', 'Decision'],
  E2_VISA: ['Business meeting & profile assessment', 'Business plan', 'Business establishment', 'Source of funds', 'Doc collection', 'Final submission', 'Decision'],
  CBI: ['Profile assessment', 'Due diligence', 'Source of funds', 'Investment / SPA signed', 'Doc collection', 'Final submission', 'Decision'],
  JR_RESUBMISSION: ['Refusal analysis', 'New evidence', 'Legal submissions', 'Final submission under process', 'Submission done', 'Decision'],
};

/** The sub-stage picklist for a service code, falling back to the default. */
export function subStagesForService(service: string): readonly string[] {
  return CATEGORY_SUBSTAGE[service] ?? DEFAULT_SUBSTAGES;
}

/** True if `value` is a member of the picklist for `service`. */
export function isValidSubStage(service: string, value: string): boolean {
  return subStagesForService(service).includes(value);
}
