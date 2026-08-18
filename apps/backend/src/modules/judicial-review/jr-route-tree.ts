import {
  JrCloseReason,
  JrDecisionMaker,
  JrInadmissibilityGround,
  JrRoute,
  JrSponsorshipRelationship,
} from '@prisma/client';

/**
 * The §6.4 route decision tree, as a pure function (no NestJS): a guided tree
 * over `decisionMaker × applicationType × sponsorshipRelationship ×
 * inadmissibilityGround`, producing `route` + `routeReasoning`.
 *
 * Two hard rules are encoded here:
 *   1. `route = IAD | RAD` is a TERMINAL REFERRAL carrying its own clock — the
 *      result returns the matching `terminalReferralCloseReason`
 *      (`REFERRED_IAD` / `REFERRED_RAD`). We refer it out; we still own the date
 *      (the `IAD_APPEAL` JrDeadline is PR 4, at the caller).
 *   2. Citizenship JR is NOT IRPA (Citizenship Act s.22.1 — same leave
 *      requirement but a 30-day deadline). v1 REJECTS a citizenship refusal
 *      rather than silently applying 15/60: the tree throws
 *      `CitizenshipMatterError`, which the caller surfaces as a
 *      BadRequestException.
 */
export interface DetermineRouteInput {
  decisionMaker: JrDecisionMaker;
  applicationType: string;
  sponsorshipRelationship?: JrSponsorshipRelationship | null;
  inadmissibilityGround?: JrInadmissibilityGround | null;
  /** RPD only: does an s.110(2) exclusion apply (→ Federal Court, not the RAD)? */
  rpdS110Exclusion?: boolean;
  /**
   * VISA_OFFICER / IRCC_IN_CANADA / CPC / CBSA: does an s.63 appeal right lie
   * (family-class sponsorship refusal s.63(1); removal order vs a PR-visa
   * holder / PR / protected person s.63(2)-(3); residency-obligation decision
   * made abroad s.63(4))?
   */
  hasS63AppealRight?: boolean;
  /** Citizenship Act refusal — v1 rejects (s.22.1, 30-day, not IRPA 15/60). */
  isCitizenshipMatter?: boolean;
}

export interface DetermineRouteResult {
  route: JrRoute;
  reasoning: string;
  /** Present only for a terminal referral (route IAD / RAD). */
  terminalReferralCloseReason?: JrCloseReason;
}

/**
 * Thrown for a citizenship refusal. Kept framework-free; the service catches it
 * and rethrows a BadRequestException (v1 does not auto-apply the IRPA clock).
 */
export class CitizenshipMatterError extends Error {
  constructor() {
    super(
      'Citizenship refusals are governed by Citizenship Act s.22.1 (a 30-day leave requirement), not IRPA s.72 (15/60). ' +
        'v1 does not auto-route citizenship matters — handle the deadline manually.',
    );
    this.name = 'CitizenshipMatterError';
  }
}

/** s.64(1)/(2) grounds that STRIP an otherwise-available s.63 appeal → Federal Court. */
const S64_STRIPPING_GROUNDS: JrInadmissibilityGround[] = [
  'SECURITY',
  'HUMAN_RIGHTS',
  'SANCTIONS',
  'SERIOUS_CRIMINALITY', // 6+ months, s.64(2)
  'ORGANIZED_CRIMINALITY',
];

function federalCourt(reasoning: string): DetermineRouteResult {
  return { route: 'FEDERAL_COURT', reasoning };
}

function referral(
  route: Extract<JrRoute, 'IAD' | 'RAD'>,
  terminalReferralCloseReason: JrCloseReason,
  reasoning: string,
): DetermineRouteResult {
  return { route, reasoning, terminalReferralCloseReason };
}

export function determineRoute(input: DetermineRouteInput): DetermineRouteResult {
  const {
    decisionMaker,
    sponsorshipRelationship,
    inadmissibilityGround,
    rpdS110Exclusion,
    hasS63AppealRight,
    isCitizenshipMatter,
  } = input;

  // Hard rule 2: a citizenship refusal is not IRPA. Reject rather than mis-clock.
  if (isCitizenshipMatter) {
    throw new CitizenshipMatterError();
  }

  // ── Who made the decision? ────────────────────────────────────────────────

  // RPD → RAD, unless an s.110(2) exclusion removes the RAD appeal.
  if (decisionMaker === 'RPD') {
    if (rpdS110Exclusion) {
      return federalCourt(
        'RPD decision within an s.110(2) exclusion (e.g. no credible basis / manifestly unfounded, ' +
          'DFN, STCA, DCO, Minister cessation/vacation): no RAD appeal lies, so judicial review of the ' +
          'RPD decision is to the Federal Court.',
      );
    }
    return referral(
      'RAD',
      'REFERRED_RAD',
      'RPD decision with an appeal right to the RAD (IRPA s.110). Terminal referral — the RAD carries its own clock.',
    );
  }

  // IAD / RAD / ID decisions are themselves reviewed by the Federal Court (in-Canada, 15 days).
  if (decisionMaker === 'IAD' || decisionMaker === 'RAD' || decisionMaker === 'ID') {
    return federalCourt(
      `${decisionMaker} decision — an in-Canada matter reviewed by the Federal Court (15-day clock).`,
    );
  }

  // VISA_OFFICER / IRCC_IN_CANADA / CPC / CBSA (and OTHER): the s.63 / s.64 tree.

  // No s.63 appeal right → Federal Court.
  if (!hasS63AppealRight) {
    return federalCourt(
      'No s.63 appeal right lies (e.g. TRV, study/work permit incl. C11/IMP, eTA, economic PR, in-Canada ' +
        'spousal, H&C s.25, PRRA, TRP, s.40 vs a non-sponsored applicant, ARC, mandamus/delay). ' +
        'Judicial review is to the Federal Court.',
    );
  }

  // An s.63 appeal right lies → is it STRIPPED by s.64?

  // s.64(1)/(2): security, human/international rights, sanctions, serious
  // criminality (6+ months), organized criminality → no appeal → Federal Court.
  if (inadmissibilityGround && S64_STRIPPING_GROUNDS.includes(inadmissibilityGround)) {
    return federalCourt(
      `s.63 appeal right is stripped by s.64(1)/(2) (${inadmissibilityGround}): no IAD appeal lies, ` +
        'so judicial review is to the Federal Court.',
    );
  }

  // s.64(3) MISREPRESENTATION — ⚠ the sharp fork.
  if (inadmissibilityGround === 'MISREPRESENTATION') {
    if (
      sponsorshipRelationship === 'SPOUSE_OR_PARTNER' ||
      sponsorshipRelationship === 'CHILD'
    ) {
      // The s.64(3) exception: the appeal SURVIVES for a sponsored spouse /
      // partner / child, so it is referred to the IAD.
      return referral(
        'IAD',
        'REFERRED_IAD',
        's.64(3): misrepresentation on a sponsored SPOUSE / PARTNER / CHILD falls within the exception — the ' +
          'IAD appeal survives. Terminal referral to the IAD (30-day clock).',
      );
    }
    // Sponsored parent / grandparent — and any other relationship — is OUTSIDE
    // the exception, so the appeal is stripped → Federal Court.
    return federalCourt(
      's.64(3): misrepresentation on a sponsored PARENT / GRANDPARENT (or outside the sponsored ' +
        'spouse/partner/child exception) strips the IAD appeal — judicial review is to the Federal Court.',
    );
  }

  // Otherwise the s.63 appeal is not stripped → IAD (terminal referral, 30-day clock).
  return referral(
    'IAD',
    'REFERRED_IAD',
    'An s.63 appeal right lies and is not stripped by s.64 — terminal referral to the IAD (30-day clock).',
  );
}
