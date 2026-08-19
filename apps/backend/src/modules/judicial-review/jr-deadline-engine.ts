import { UnprocessableEntityException } from '@nestjs/common';
import { JrDeadlineRule, JrMatter } from '@prisma/client';
import { rollForwardIfClosed } from './jr-registry-calendar';

/**
 * The Federal Court JR deadline engine (§7.2), as a pure module. Given a matter's
 * anchor dates and the active, versioned deadline RULES, it emits one
 * {@link ComputedDeadline} per applicable milestone. It is framework-free apart
 * from a single plain exception class (UnprocessableEntityException) used to
 * refuse quoting an unverified date to a client.
 *
 * Two hard invariants live here:
 *   - The 15/60 ALJR-filing period is selected SOLELY from
 *     `decidingOfficeLocation` (never from Client / Lead / a visa-office name).
 *   - A deadline whose governing rule row is not VERIFIED is NOT quotable to a
 *     client (assertQuotable throws).
 */

// ---------------------------------------------------------------------------
// UTC calendar arithmetic
// ---------------------------------------------------------------------------

/**
 * Add `n` calendar days to a date in UTC, returning a NEW Date. Because the
 * clock "starts the day AFTER" the anchor (Interpretation Act s.27(4)–(5)),
 * addCalendarDays(anchor, N) lands on the LAST day of an N-day period counted
 * from the day after the anchor. (Verified: 2025-05-14 + 60 = 2025-07-13.)
 */
export function addCalendarDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

/** Subtract `n` calendar days from a date in UTC, returning a NEW Date. */
export function subCalendarDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n));
}

/**
 * Normalize a client-supplied ISO date string to the UTC-midnight of the
 * CALENDAR DAY the client stated. A JR anchor is a legal calendar date (the day
 * the officer decided / the record was filed), never an instant — so a zoned
 * timestamp like "2026-05-14T20:00:00-04:00" must resolve to 2026-05-14, NOT the
 * UTC-rolled 2026-05-15. Storing the raw `new Date(iso)` would let a stray
 * time-of-day drift a FATAL deadline a day later (the dangerous direction), so
 * every anchor is passed through this at the write boundary.
 */
export function toLegalDateUtc(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Fallback (unreachable after @IsDateString): truncate the instant to its UTC day.
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ---------------------------------------------------------------------------
// ALJR 15/60 variant — the single source of truth
// ---------------------------------------------------------------------------

/**
 * The ALJR-filing period variant. It is SOLELY `decidingOfficeLocation`, returned
 * verbatim. There is deliberately NO code path deriving 15/60 from
 * Client.country / nationality, Lead.*, or a visa-office name — the period turns
 * on the office that made the decision, as asserted on the filed Form IR-1.
 *
 * UNKNOWN is deliberately 15 days (it selects the seeded UNKNOWN rule, which is
 * 15). Never widen this.
 */
export function aljrFilingVariant(
  m: Pick<JrMatter, 'decidingOfficeLocation'>,
): 'IN_CANADA' | 'OUTSIDE_CANADA' | 'UNKNOWN' {
  return m.decidingOfficeLocation;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The matter fields the engine reads. Nothing else may influence a deadline. */
export type MatterForCompute = Pick<
  JrMatter,
  | 'decidingOfficeLocation'
  | 'route'
  | 'decisionCommunicatedAt'
  | 'aljrServedAt'
  | 'aljrFiledAt'
  | 'reasonsPleadedAsReceived'
  | 'rule9ResponseAt'
  | 'applicantRecordServedAt'
  | 'respondentMemoServedAt'
  | 'leaveOrderAt'
  | 'leaveGranted'
  | 'hearingAt'
  | 'judgmentAt'
  | 'certifiedQuestionStatus'
  | 'deadlineRuleSetVersion'
>;

/** The rule fields the engine reads (a JrDeadlineRule is assignable to this). */
export type RuleForCompute = Pick<
  JrDeadlineRule,
  | 'id'
  | 'ruleSetVersion'
  | 'milestoneKey'
  | 'variantKey'
  | 'baseDays'
  | 'modifierDays'
  | 'offsetDirection'
  | 'effectiveFrom'
  | 'effectiveTo'
  | 'verificationStatus'
>;

export interface ComputedDeadline {
  milestoneKey: string;
  label: string | null;
  anchorDate: Date;
  anchorField: string;
  computedDueAt: Date;
  ruleId: string;
  ruleSetVersion: number;
  isFatal: boolean;
  quotableToClient: boolean;
}

// ---------------------------------------------------------------------------
// Milestone catalog
// ---------------------------------------------------------------------------

/** The two FATAL milestones — a missed date here ends the case. */
const FATAL_MILESTONES = new Set<string>(['ALJR_FILING', 'RULE_10_PERFECTION']);

interface MilestoneDef {
  key: string;
  /** Only ALJR_FILING has a variant (the 15/60 discriminator). */
  variantOf?: (m: MatterForCompute) => string;
  anchor: (m: MatterForCompute) => { date: Date | null; field: string };
  appliesWhen: (m: MatterForCompute) => boolean;
}

/**
 * A Federal Court milestone applies while the route is NOT a terminal IAD/RAD
 * referral — i.e. FEDERAL_COURT or (still) UNDETERMINED.
 */
function isFederalCourtRoute(m: MatterForCompute): boolean {
  return m.route !== 'IAD' && m.route !== 'RAD';
}

const MILESTONES: MilestoneDef[] = [
  {
    key: 'ALJR_FILING',
    variantOf: (m) => aljrFilingVariant(m),
    anchor: (m) => ({ date: m.decisionCommunicatedAt, field: 'decisionCommunicatedAt' }),
    appliesWhen: (m) => isFederalCourtRoute(m),
  },
  {
    key: 'PROOF_OF_SERVICE',
    anchor: (m) => ({ date: m.aljrServedAt, field: 'aljrServedAt' }),
    appliesWhen: (m) => isFederalCourtRoute(m),
  },
  {
    key: 'NOTICE_OF_APPEARANCE',
    anchor: (m) => ({ date: m.aljrServedAt, field: 'aljrServedAt' }),
    appliesWhen: (m) => isFederalCourtRoute(m),
  },
  {
    key: 'RULE_10_PERFECTION',
    // Perfection runs from filing when reasons were pleaded as already received,
    // otherwise from the Rule 9 response.
    anchor: (m) =>
      m.reasonsPleadedAsReceived === true
        ? { date: m.aljrFiledAt, field: 'aljrFiledAt' }
        : { date: m.rule9ResponseAt, field: 'rule9ResponseAt' },
    appliesWhen: (m) => isFederalCourtRoute(m) && m.aljrFiledAt != null,
  },
  {
    key: 'RULE_11_RESPONDENT_RECORD',
    anchor: (m) => ({ date: m.applicantRecordServedAt, field: 'applicantRecordServedAt' }),
    appliesWhen: (m) => isFederalCourtRoute(m),
  },
  {
    key: 'RULE_13_REPLY',
    anchor: (m) => ({ date: m.respondentMemoServedAt, field: 'respondentMemoServedAt' }),
    appliesWhen: (m) => isFederalCourtRoute(m),
  },
  {
    key: 'POST_LEAVE_SETTLEMENT',
    anchor: (m) => ({ date: m.leaveOrderAt, field: 'leaveOrderAt' }),
    appliesWhen: (m) => m.leaveGranted === true,
  },
  {
    key: 'CERTIFIED_QUESTION_NOTICE',
    anchor: (m) => ({ date: m.hearingAt, field: 'hearingAt' }),
    appliesWhen: (m) => m.hearingAt != null,
  },
  {
    key: 'FCA_NOTICE_OF_APPEAL',
    anchor: (m) => ({ date: m.judgmentAt, field: 'judgmentAt' }),
    appliesWhen: (m) => m.certifiedQuestionStatus === 'CERTIFIED',
  },
  {
    key: 'IAD_APPEAL',
    anchor: (m) => ({ date: m.decisionCommunicatedAt, field: 'decisionCommunicatedAt' }),
    appliesWhen: (m) => m.route === 'IAD',
  },
  {
    key: 'RAD_APPEAL',
    anchor: (m) => ({ date: m.decisionCommunicatedAt, field: 'decisionCommunicatedAt' }),
    appliesWhen: (m) => m.route === 'RAD',
  },
  // v1 gap: FCA_SERVICE needs an fcaNoticeFiledAt field — that anchor is not yet
  // modelled on JrMatter, so FCA_SERVICE is not auto-computed here.
  // UNDERLYING_DOC_EXPIRY is endpoint-created (addUnderlyingDocWatch), never
  // auto-computed.
];

/**
 * The milestone keys this engine can auto-compute. The recompute persistence uses
 * it to scope which existing deadlines it may retire when a milestone stops
 * applying — it must never touch endpoint-created rows (UNDERLYING_DOC_EXPIRY).
 */
export const AUTO_COMPUTED_MILESTONE_KEYS: readonly string[] = MILESTONES.map((d) => d.key);

// ---------------------------------------------------------------------------
// Rule selection + compute
// ---------------------------------------------------------------------------

/**
 * Select the governing rule for a milestone at an anchor date: milestone match,
 * variant match (the specific variant OR an unconditional null-variant rule),
 * and an effective window covering the anchor. When several match, the most
 * specific wins (variant over null), then the latest effectiveFrom. Returns null
 * when nothing matches (the caller then skips — it never throws).
 */
function selectRule(
  rules: RuleForCompute[],
  milestoneKey: string,
  variant: string | undefined,
  anchorDate: Date,
): RuleForCompute | null {
  const at = anchorDate.getTime();
  const candidates = rules.filter((r) => {
    if (r.milestoneKey !== milestoneKey) return false;
    if (!(r.variantKey === variant || r.variantKey == null)) return false;
    if (r.effectiveFrom.getTime() > at) return false;
    if (r.effectiveTo != null && r.effectiveTo.getTime() < at) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aVar = a.variantKey != null ? 1 : 0;
    const bVar = b.variantKey != null ? 1 : 0;
    if (aVar !== bVar) return bVar - aVar; // most specific first
    return b.effectiveFrom.getTime() - a.effectiveFrom.getTime(); // latest first
  });
  return candidates[0];
}

/**
 * Compute every applicable deadline for a matter from the active rule set (§7.2).
 * For each catalog milestone whose precondition holds and whose anchor date is
 * present, it selects the governing rule, applies `baseDays + modifierDays` in
 * the rule's offset direction as CALENDAR days, then rolls a terminal-day landing
 * on a closed Registry day forward (Interpretation Act s.26). A milestone with no
 * matching rule is silently skipped.
 */
export interface ComputeResult {
  deadlines: ComputedDeadline[];
  /**
   * FATAL milestones that applied AND had an anchor date, but for which NO rule
   * matched (missing seed row, or an effectiveFrom window that excludes the
   * anchor). A fatal deadline must never vanish silently — the caller logs/audits
   * this so a seed misconfiguration is loud, not invisible.
   */
  unmatchedFatal: string[];
}

/**
 * Compute every applicable deadline for a matter, and separately report any FATAL
 * milestone that should have produced a deadline but found no governing rule.
 */
export function computeDeadlinesDetailed(
  m: MatterForCompute,
  rules: RuleForCompute[],
): ComputeResult {
  const deadlines: ComputedDeadline[] = [];
  const unmatchedFatal: string[] = [];
  for (const def of MILESTONES) {
    if (!def.appliesWhen(m)) continue;
    const { date: anchorDate, field } = def.anchor(m);
    if (anchorDate == null) continue;
    const variant = def.variantOf ? def.variantOf(m) : undefined;
    const rule = selectRule(rules, def.key, variant, anchorDate);
    if (!rule) {
      if (FATAL_MILESTONES.has(def.key)) unmatchedFatal.push(def.key);
      continue;
    }

    const days = rule.baseDays + rule.modifierDays;
    const raw =
      rule.offsetDirection === 'AFTER'
        ? addCalendarDays(anchorDate, days)
        : subCalendarDays(anchorDate, days);
    const computedDueAt = rollForwardIfClosed(raw);

    deadlines.push({
      milestoneKey: def.key,
      label: null,
      anchorDate,
      anchorField: field,
      computedDueAt,
      ruleId: rule.id,
      ruleSetVersion: rule.ruleSetVersion,
      isFatal: FATAL_MILESTONES.has(def.key),
      quotableToClient: rule.verificationStatus === 'VERIFIED',
    });
  }
  return { deadlines, unmatchedFatal };
}

/** As {@link computeDeadlinesDetailed}, returning only the deadlines. */
export function computeDeadlines(m: MatterForCompute, rules: RuleForCompute[]): ComputedDeadline[] {
  return computeDeadlinesDetailed(m, rules).deadlines;
}

/**
 * Guard a client-facing render of a computed deadline: refuse when its governing
 * rule is not VERIFIED. A human must read the governing order and mark the rule
 * VERIFIED before the date may be communicated to a client.
 */
export function assertQuotable(d: {
  quotableToClient: boolean;
  milestoneKey: string;
  ruleId: string;
}): void {
  if (d.quotableToClient) return;
  throw new UnprocessableEntityException(
    `Deadline ${d.milestoneKey} derives from an UNVERIFIED rule row (${d.ruleId}). A human must read the governing order and mark the rule VERIFIED before this date may be communicated to a client.`,
  );
}
