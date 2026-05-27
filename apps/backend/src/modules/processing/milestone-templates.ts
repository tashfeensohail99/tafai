/**
 * Per-service-type milestone templates. Populated onto each ProcessingCase
 * at acknowledge time so the assigned associate sees a checkable progress
 * narrative tailored to the case type they're working.
 *
 * Independent of the gated ProcessingCaseStage machine — managers move
 * stages; associates tick milestones. Both update on the case timeline.
 *
 * Adding a milestone here doesn't retro-fit existing cases; it only takes
 * effect for cases acknowledged after the deploy. Manager can add an
 * ad-hoc milestone from the workspace if needed (POST .../milestones).
 */

import type { ServiceTypeCode } from '../../common/service-types';

export interface MilestoneTemplate {
  title: string;
  description?: string;
}

const SHARED_OPEN: MilestoneTemplate[] = [
  { title: 'Case Initiated', description: 'Case acknowledged from Finance and assigned to processing associate.' },
  { title: 'Documents Assessment & Collection', description: 'Review required documents per the checklist; chase any missing items from the client.' },
];

const SHARED_CLOSE: MilestoneTemplate[] = [
  { title: 'Final Case Processing', description: 'Final QA on the package before submission — completeness, formatting, signatures.' },
  { title: 'Final Submission', description: 'Package filed with the authority; tracking reference captured.' },
];

// Each list runs in order; sortOrder is set from the array index at insert.
export const MILESTONE_TEMPLATES: Record<ServiceTypeCode, MilestoneTemplate[]> = {
  STUDY_VISA: [
    ...SHARED_OPEN,
    { title: 'Profile Drafting', description: 'Statement of Purpose, study plan, and supporting profile narrative drafted.' },
    { title: 'Language Test Verification', description: 'IELTS / TOEFL / PTE result on file and within validity.' },
    ...SHARED_CLOSE,
  ],
  WORK_PERMIT: [
    ...SHARED_OPEN,
    { title: 'Profile Drafting', description: 'CV, work-history summary, and employer-facing profile drafted.' },
    { title: 'LMIA / Exemption Submission', description: 'Labour Market Impact Assessment filed (or exemption code identified) where required.' },
    { title: 'Offer Letter', description: 'Signed employer offer letter on file matching the LMIA / position details.' },
    ...SHARED_CLOSE,
  ],
  PR_CASE: [
    ...SHARED_OPEN,
    { title: 'Profile Drafting', description: 'Points-based profile drafted; ECA, work history, and language scores aligned.' },
    { title: 'Express Entry / Pool Entry', description: 'Profile submitted into the relevant pool / draw if applicable.' },
    ...SHARED_CLOSE,
  ],
  E2_VISA: [
    ...SHARED_OPEN,
    { title: 'Profile Drafting', description: 'Investor profile and business background documented.' },
    { title: 'Business Plan', description: '5-year business plan with financial projections + hiring plan finalised.' },
    { title: 'Business Meeting', description: 'Strategy meeting with investor + counsel to finalise structure.' },
    { title: 'Incorporation', description: 'US business incorporated; EIN issued; bank account opened.' },
    { title: 'Source of Funds Documentation', description: 'Full paper trail proving lawful source of investment funds.' },
    ...SHARED_CLOSE,
  ],
  CBI: [
    ...SHARED_OPEN,
    { title: 'Due Diligence Package', description: 'Personal-history + reference letters compiled; program due-diligence form completed.' },
    { title: 'Source of Funds Verification', description: 'Detailed paper trail proving lawful source of investment + supporting wealth.' },
    { title: 'Investment / SPA Signed', description: 'Sale & Purchase Agreement or contribution confirmation signed per program option.' },
    ...SHARED_CLOSE,
  ],
  VISIT_VISA: [
    ...SHARED_OPEN,
    { title: 'Travel Plan & Sponsorship', description: 'Itinerary, hotel + flight bookings, and (if applicable) invitation letter assembled.' },
    { title: 'Ties-to-Home Evidence', description: 'Employment letter, financial proof, and other return-intent evidence gathered.' },
    ...SHARED_CLOSE,
  ],
  TOURIST_VISA: [
    ...SHARED_OPEN,
    { title: 'Travel Plan Assembly', description: 'Detailed itinerary, hotel bookings, return flights, travel insurance.' },
    { title: 'Ties-to-Home Evidence', description: 'Employment letter, leave approval, financial proof of return intent.' },
    ...SHARED_CLOSE,
  ],
  SPOUSE_VISA: [
    ...SHARED_OPEN,
    { title: 'Relationship Evidence', description: 'Marriage certificate, wedding photos, communication history, joint financial records.' },
    { title: 'Sponsor Verification', description: 'Sponsor passport / status proof + income / employment evidence.' },
    { title: 'Statement of Relationship', description: 'Written narrative covering how the couple met through to present-day relationship.' },
    ...SHARED_CLOSE,
  ],
  JR_RESUBMISSION: [
    { title: 'Refusal Analysis', description: 'Read previous refusal letter + GCMS notes; map each refusal ground to a response strategy.' },
    { title: 'Previous Package Review', description: 'Pull and review the previously submitted application package end-to-end.' },
    { title: 'New Evidence Compilation', description: 'New evidence directly addressing each refusal ground assembled.' },
    { title: 'Legal Submissions', description: 'Counsel memo + sworn affidavit / statutory declaration drafted.' },
    ...SHARED_CLOSE,
  ],
};

/**
 * Get the milestone template for a service code. Returns SHARED_OPEN +
 * SHARED_CLOSE as a safe fallback if the service code isn't recognised
 * (shouldn't happen post-P2 since the DTO is @IsIn(SERVICE_TYPE_CODES),
 * but we never want this to blow up an acknowledge).
 */
export function getMilestonesForService(service: string): MilestoneTemplate[] {
  const list = MILESTONE_TEMPLATES[service as ServiceTypeCode];
  if (list) return list;
  return [...SHARED_OPEN, ...SHARED_CLOSE];
}
