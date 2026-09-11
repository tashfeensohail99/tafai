/**
 * Per-service sub-stage picklists (feedback F3) — frontend mirror of the
 * backend `substage-templates.ts`. Keep the two in sync by hand (same pattern
 * as lib/service-types.ts). Sub-stages are display/tracking labels only; they
 * never affect the case stage, gates, SLA, or reporting.
 *
 * Only the two flows the feedback specified (Visit Visa + LMIA-exempt Work
 * Permit) get a fixed dropdown. Every other service is free-text — the officer
 * types the label manually or leaves it blank.
 */

// Cross-cutting case-status labels appended to every dropdown flow (processing
// team request, 2026-09-11). Display-only tracking labels. MUST stay identical
// to the backend substage-templates.ts CASE_STATUS_LABELS or the backend
// validator will reject a value this dropdown offers.
const CASE_STATUS_LABELS = [
  'Case Approve', 'Case Refuse', 'In process', 'Case shifted to JR',
  'Case on hold', 'Waiting for Request letter', 'Case Submitted',
];

export const CATEGORY_SUBSTAGE: Record<string, string[]> = {
  VISIT_VISA: ['Doc collection', 'Hold', 'Final submission under process', 'Submission done', 'Decision', ...CASE_STATUS_LABELS],
  WORK_PERMIT: ['Business meeting & profile assessment', 'Business establishment', 'Exemption', 'Doc collection', 'Final submission', 'Decision', ...CASE_STATUS_LABELS],
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
