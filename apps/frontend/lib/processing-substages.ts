/**
 * Per-service sub-stage picklists (feedback F3) — frontend mirror of the
 * backend `substage-templates.ts`. Keep the two in sync by hand (same pattern
 * as lib/service-types.ts). Sub-stages are display/tracking labels only; they
 * never affect the case stage, gates, SLA, or reporting.
 */

export const DEFAULT_SUBSTAGES: string[] = [
  'Doc collection',
  'Hold',
  'Final submission under process',
  'Submission done',
  'Decision',
];

export const CATEGORY_SUBSTAGE: Record<string, string[]> = {
  STUDY_VISA: ['Profile assessment', 'Admission / offer', 'Doc collection', 'Final submission under process', 'Submission done', 'Decision'],
  WORK_PERMIT: ['Business meeting & profile assessment', 'Business establishment', 'Exemption', 'Doc collection', 'Final submission', 'Decision'],
  PR_CASE: ['Profile assessment', 'Pool / EOI entry', 'Doc collection', 'Final submission under process', 'Submission done', 'Decision'],
  VISIT_VISA: ['Doc collection', 'Hold', 'Final submission under process', 'Submission done', 'Decision'],
  TOURIST_VISA: ['Doc collection', 'Hold', 'Final submission under process', 'Submission done', 'Decision'],
  SPOUSE_VISA: ['Relationship evidence', 'Doc collection', 'Sponsor verification', 'Final submission under process', 'Submission done', 'Decision'],
  E2_VISA: ['Business meeting & profile assessment', 'Business plan', 'Business establishment', 'Source of funds', 'Doc collection', 'Final submission', 'Decision'],
  CBI: ['Profile assessment', 'Due diligence', 'Source of funds', 'Investment / SPA signed', 'Doc collection', 'Final submission', 'Decision'],
  JR_RESUBMISSION: ['Refusal analysis', 'New evidence', 'Legal submissions', 'Final submission under process', 'Submission done', 'Decision'],
};

/** The sub-stage picklist for a service code, falling back to the default. */
export function subStagesForService(service: string): string[] {
  return CATEGORY_SUBSTAGE[service] ?? DEFAULT_SUBSTAGES;
}
