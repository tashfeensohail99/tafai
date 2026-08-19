/**
 * JR deadline alerting policy — pure data + selectors (no Nest, no I/O).
 *
 * The sweeper (jr-deadline-sweeper.service.ts) walks PENDING deadlines and asks
 * this module two questions:
 *   1. which config row governs this deadline (configKeyForDeadline), and
 *   2. given the days remaining, which alert tier (if any) should fire now
 *      (resolveActiveTier).
 *
 * Keeping the policy pure makes the countdown behaviour unit-testable without a
 * database, and lets the "one tier per crossing" rule be verified in isolation.
 */

const DAY = 86_400_000;

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export type AlertRecipient = 'HEAD' | 'ASSOCIATE' | 'ADMIN';
export type AlertChannel = 'BELL' | 'EMAIL';

export interface TierConfig {
  /** Days-before-due at which a warning fires (each crossing fires once). */
  thresholds: number[];
  /** Whether an OVERDUE alert fires once the deadline has passed. */
  overdue: boolean;
  recipients: AlertRecipient[];
  channels: AlertChannel[];
}

/**
 * The alerting policy, keyed by config row. The two ALJR_FILING rows are the
 * fatal ones (15/60-day originating clock) and get the widest recipient set +
 * email; the minor procedural milestones are bell-only nudges to the associate.
 * RULE_11_RESPONDENT_RECORD is deliberately absent — it's the respondent's clock,
 * not ours, so no alert fires for it.
 */
export const ALERT_TIERS: Record<string, TierConfig> = {
  ALJR_FILING_60: {
    thresholds: [45, 30, 15, 7, 5, 3, 1],
    overdue: true,
    recipients: ['HEAD', 'ASSOCIATE', 'ADMIN'],
    channels: ['BELL', 'EMAIL'],
  },
  ALJR_FILING_15: {
    thresholds: [10, 7, 5, 3, 1],
    overdue: true,
    recipients: ['HEAD', 'ASSOCIATE', 'ADMIN'],
    channels: ['BELL', 'EMAIL'],
  },
  RULE_10_PERFECTION: {
    thresholds: [30, 14, 7, 3, 1],
    overdue: true,
    recipients: ['HEAD', 'ASSOCIATE'],
    channels: ['BELL', 'EMAIL'],
  },
  RULE_13_REPLY: {
    thresholds: [10, 7, 3, 1],
    overdue: true,
    recipients: ['HEAD', 'ASSOCIATE'],
    channels: ['BELL', 'EMAIL'],
  },
  ADDITIONAL_SUBMISSIONS: {
    thresholds: [14, 7, 3, 1],
    overdue: true,
    recipients: ['HEAD', 'ASSOCIATE'],
    channels: ['BELL', 'EMAIL'],
  },
  PROOF_OF_SERVICE: {
    thresholds: [3, 1],
    overdue: false,
    recipients: ['ASSOCIATE'],
    channels: ['BELL'],
  },
  NOTICE_OF_APPEARANCE: {
    thresholds: [3, 1],
    overdue: false,
    recipients: ['ASSOCIATE'],
    channels: ['BELL'],
  },
  POST_LEAVE_SETTLEMENT: {
    thresholds: [3, 1],
    overdue: false,
    recipients: ['ASSOCIATE'],
    channels: ['BELL'],
  },
  CERTIFIED_QUESTION_NOTICE: {
    thresholds: [3, 1],
    overdue: false,
    recipients: ['ASSOCIATE'],
    channels: ['BELL'],
  },
  FCA_NOTICE_OF_APPEAL: {
    thresholds: [10, 3, 1],
    overdue: false,
    recipients: ['HEAD', 'ASSOCIATE'],
    channels: ['BELL'],
  },
  FCA_SERVICE: {
    thresholds: [3, 1],
    overdue: false,
    recipients: ['ASSOCIATE'],
    channels: ['BELL'],
  },
  IAD_APPEAL: {
    thresholds: [7, 3, 1],
    overdue: false,
    recipients: ['HEAD', 'ASSOCIATE'],
    channels: ['BELL'],
  },
  RAD_APPEAL: {
    thresholds: [7, 3, 1],
    overdue: false,
    recipients: ['HEAD', 'ASSOCIATE'],
    channels: ['BELL'],
  },
  UNDERLYING_DOC_EXPIRY: {
    thresholds: [60, 30, 7],
    overdue: false,
    recipients: ['ASSOCIATE'],
    channels: ['BELL'],
  },
};

/**
 * Map a deadline to its config row. ALJR_FILING carries the 15-vs-60-day fork:
 * the gap between the anchor (decision communicated) and the computed due date
 * tells us which clock this matter is on.
 */
export function configKeyForDeadline(d: {
  milestoneKey: string;
  anchorDate: Date;
  computedDueAt: Date;
}): string {
  if (d.milestoneKey === 'ALJR_FILING') {
    const gap = Math.round((utcMidnight(d.computedDueAt) - utcMidnight(d.anchorDate)) / DAY);
    return gap > 30 ? 'ALJR_FILING_60' : 'ALJR_FILING_15';
  }
  return d.milestoneKey;
}

export interface ActiveTier {
  tier: string;
  recipients: AlertRecipient[];
  channels: AlertChannel[];
}

/**
 * Given the governing config and days-until-due, return the single tier that
 * should fire now (or null). The key rule: pick the SMALLEST threshold that is
 * still >= daysUntil — the tightest not-yet-crossed warning. This means a
 * deadline created at T-3 fires only "T-3", never a burst of T-45…T-3, while a
 * deadline that ages one day at a time fires each tier exactly once as it is
 * crossed (dedup at the ledger prevents re-fires).
 */
export function resolveActiveTier(configKey: string, daysUntil: number): ActiveTier | null {
  const cfg = ALERT_TIERS[configKey];
  if (!cfg) return null;

  if (daysUntil < 0) {
    return cfg.overdue
      ? { tier: 'OVERDUE', recipients: cfg.recipients, channels: cfg.channels }
      : null;
  }

  const t = cfg.thresholds.filter((x) => x >= daysUntil).sort((a, b) => a - b)[0];
  if (t === undefined) return null;
  return { tier: `T-${t}`, recipients: cfg.recipients, channels: cfg.channels };
}
