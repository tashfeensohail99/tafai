import {
  addCalendarDays,
  subCalendarDays,
  aljrFilingVariant,
  assertQuotable,
  computeDeadlines,
  computeDeadlinesDetailed,
  toLegalDateUtc,
  AUTO_COMPUTED_MILESTONE_KEYS,
  ComputedDeadline,
  MatterForCompute,
  RuleForCompute,
} from './jr-deadline-engine';
import { rollForwardIfClosed } from './jr-registry-calendar';

// ---------------------------------------------------------------------------
// Builders — construct rule arrays + matters inline; never touch the DB.
// ---------------------------------------------------------------------------

function matter(overrides: Partial<MatterForCompute> = {}): MatterForCompute {
  return {
    decidingOfficeLocation: 'OUTSIDE_CANADA',
    route: 'FEDERAL_COURT',
    decisionCommunicatedAt: null,
    aljrServedAt: null,
    aljrFiledAt: null,
    reasonsPleadedAsReceived: null,
    rule9ResponseAt: null,
    applicantRecordServedAt: null,
    respondentMemoServedAt: null,
    leaveOrderAt: null,
    leaveGranted: null,
    hearingAt: null,
    judgmentAt: null,
    certifiedQuestionStatus: 'NOT_SOUGHT',
    deadlineRuleSetVersion: 1,
    ...overrides,
  };
}

let ruleSeq = 0;
function rule(
  overrides: Partial<RuleForCompute> & { milestoneKey: string; baseDays: number },
): RuleForCompute {
  return {
    id: `rule-${++ruleSeq}`,
    ruleSetVersion: 1,
    variantKey: null,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    effectiveFrom: new Date('2001-01-01T00:00:00.000Z'),
    effectiveTo: null,
    verificationStatus: 'VERIFIED',
    ...overrides,
  };
}

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function find(list: ComputedDeadline[], key: string): ComputedDeadline | undefined {
  return list.find((x) => x.milestoneKey === key);
}

// The seeded ALJR 15/60/UNKNOWN variant rules (all VERIFIED).
const ALJR_RULES: RuleForCompute[] = [
  rule({ milestoneKey: 'ALJR_FILING', variantKey: 'IN_CANADA', baseDays: 15 }),
  rule({ milestoneKey: 'ALJR_FILING', variantKey: 'OUTSIDE_CANADA', baseDays: 60 }),
  rule({ milestoneKey: 'ALJR_FILING', variantKey: 'UNKNOWN', baseDays: 15 }),
];

// ---------------------------------------------------------------------------

describe('jr-deadline-engine', () => {
  describe('UTC calendar arithmetic', () => {
    it('addCalendarDays lands on the last day of the period (2025-05-14 + 60 = 2025-07-13)', () => {
      expect(addCalendarDays(d('2025-05-14'), 60).toISOString()).toBe('2025-07-13T00:00:00.000Z');
    });

    it('subCalendarDays subtracts calendar days in UTC', () => {
      expect(subCalendarDays(d('2025-06-23'), 5).toISOString()).toBe('2025-06-18T00:00:00.000Z');
    });
  });

  describe('Invariant 1 — a milestone-scoped modifier touches ONLY its milestone', () => {
    it('a +90 on RULE_10_PERFECTION leaves RULE_11 at 30 and RULE_13 at 10', () => {
      const rules = [
        rule({ milestoneKey: 'RULE_10_PERFECTION', baseDays: 30, modifierDays: 90 }),
        rule({ milestoneKey: 'RULE_11_RESPONDENT_RECORD', baseDays: 30 }),
        rule({ milestoneKey: 'RULE_13_REPLY', baseDays: 10 }),
      ];
      const m = matter({
        reasonsPleadedAsReceived: false,
        aljrFiledAt: d('2025-02-01'),
        rule9ResponseAt: d('2025-03-10'), // +120 → 2025-07-08 (Tue, open)
        applicantRecordServedAt: d('2025-03-03'), // +30 → 2025-04-02 (Wed, open)
        respondentMemoServedAt: d('2025-03-03'), // +10 → 2025-03-13 (Thu, open)
      });
      const out = computeDeadlines(m, rules);

      // RULE_11 must be exactly 30 days — NOT 120.
      expect(find(out, 'RULE_11_RESPONDENT_RECORD')!.computedDueAt.toISOString()).toBe(
        '2025-04-02T00:00:00.000Z',
      );
      // RULE_13 must be exactly 10 days — NOT 100.
      expect(find(out, 'RULE_13_REPLY')!.computedDueAt.toISOString()).toBe(
        '2025-03-13T00:00:00.000Z',
      );
      // The +90 lands ONLY on perfection (30 + 90 = 120 days).
      expect(find(out, 'RULE_10_PERFECTION')!.computedDueAt.toISOString()).toBe(
        '2025-07-08T00:00:00.000Z',
      );
    });
  });

  describe('Worked example — ALJR filing (OUTSIDE_CANADA, 60 days)', () => {
    it('2025-05-14 + 60 rolls the Sunday terminal day forward to Mon 2025-07-14', () => {
      const m = matter({
        decidingOfficeLocation: 'OUTSIDE_CANADA',
        decisionCommunicatedAt: d('2025-05-14'),
      });
      const aljr = find(computeDeadlines(m, ALJR_RULES), 'ALJR_FILING')!;
      // Raw 60-day arithmetic is 2025-07-13 (a Sunday)…
      expect(addCalendarDays(d('2025-05-14'), 60).toISOString()).toBe('2025-07-13T00:00:00.000Z');
      // …which the Registry is closed on, so the deadline is s.26-rolled to Monday.
      expect(aljr.computedDueAt.toISOString()).toBe('2025-07-14T00:00:00.000Z');
      expect(aljr.isFatal).toBe(true);
      expect(aljr.quotableToClient).toBe(true);
      expect(aljr.anchorField).toBe('decisionCommunicatedAt');
    });
  });

  describe('Worked example — Rule 10 perfection (VERIFIED historical rule, 30 + 45)', () => {
    it('rule9ResponseAt 2025-09-03 + 75 = 2025-11-17, quotable', () => {
      const rules = [
        rule({
          milestoneKey: 'RULE_10_PERFECTION',
          baseDays: 30,
          modifierDays: 45,
          verificationStatus: 'VERIFIED',
          effectiveFrom: d('2025-05-14'),
        }),
      ];
      const m = matter({
        reasonsPleadedAsReceived: false,
        aljrFiledAt: d('2025-07-11'),
        rule9ResponseAt: d('2025-09-03'),
      });
      const p = find(computeDeadlines(m, rules), 'RULE_10_PERFECTION')!;
      expect(p.computedDueAt.toISOString()).toBe('2025-11-17T00:00:00.000Z');
      expect(p.quotableToClient).toBe(true);
      expect(p.isFatal).toBe(true);
      expect(p.anchorField).toBe('rule9ResponseAt');
      expect(() => assertQuotable(p)).not.toThrow();
    });
  });

  describe('Seeded-regime perfection is UNVERIFIED — not quotable', () => {
    it('30 + 90 UNVERIFIED yields quotableToClient=false and assertQuotable throws', () => {
      const rules = [
        rule({
          milestoneKey: 'RULE_10_PERFECTION',
          baseDays: 30,
          modifierDays: 90,
          verificationStatus: 'UNVERIFIED',
        }),
      ];
      const m = matter({
        reasonsPleadedAsReceived: false,
        aljrFiledAt: d('2025-07-11'),
        rule9ResponseAt: d('2025-09-03'),
      });
      const p = find(computeDeadlines(m, rules), 'RULE_10_PERFECTION')!;
      expect(p.quotableToClient).toBe(false);
      expect(() => assertQuotable(p)).toThrow(/UNVERIFIED rule row/);
    });
  });

  describe('Invariant 3 — the 15/60 period comes ONLY from decidingOfficeLocation', () => {
    it('aljrFilingVariant returns the office location verbatim', () => {
      expect(aljrFilingVariant({ decidingOfficeLocation: 'IN_CANADA' })).toBe('IN_CANADA');
      expect(aljrFilingVariant({ decidingOfficeLocation: 'OUTSIDE_CANADA' })).toBe('OUTSIDE_CANADA');
      expect(aljrFilingVariant({ decidingOfficeLocation: 'UNKNOWN' })).toBe('UNKNOWN');
    });

    it('UNKNOWN and IN_CANADA select 15 days; OUTSIDE_CANADA selects 60', () => {
      const anchor = d('2025-01-06');
      const due = (loc: MatterForCompute['decidingOfficeLocation']) =>
        find(
          computeDeadlines(matter({ decidingOfficeLocation: loc, decisionCommunicatedAt: anchor }), ALJR_RULES),
          'ALJR_FILING',
        )!.computedDueAt.toISOString();

      const expected15 = rollForwardIfClosed(addCalendarDays(anchor, 15)).toISOString();
      const expected60 = rollForwardIfClosed(addCalendarDays(anchor, 60)).toISOString();

      expect(due('UNKNOWN')).toBe(expected15);
      expect(due('IN_CANADA')).toBe(expected15);
      expect(due('OUTSIDE_CANADA')).toBe(expected60);
      expect(expected15).not.toBe(expected60);
    });
  });

  describe('Terminal-day rollover (Interpretation Act s.26)', () => {
    it('a raw date on a Saturday rolls forward to the following Monday', () => {
      const rules = [rule({ milestoneKey: 'RULE_13_REPLY', baseDays: 10 })];
      // 2025-11-05 + 10 = 2025-11-15 (Sat) → Mon 2025-11-17.
      const m = matter({ respondentMemoServedAt: d('2025-11-05') });
      expect(find(computeDeadlines(m, rules), 'RULE_13_REPLY')!.computedDueAt.toISOString()).toBe(
        '2025-11-17T00:00:00.000Z',
      );
    });

    it('a raw date on Christmas rolls past Boxing Day + the weekend to Mon 2025-12-29', () => {
      const rules = [rule({ milestoneKey: 'RULE_13_REPLY', baseDays: 10 })];
      // 2025-12-15 + 10 = 2025-12-25 (Thu, Christmas) → 26 (Fri, Boxing) → 27/28 (weekend) → Mon 29.
      const m = matter({ respondentMemoServedAt: d('2025-12-15') });
      expect(find(computeDeadlines(m, rules), 'RULE_13_REPLY')!.computedDueAt.toISOString()).toBe(
        '2025-12-29T00:00:00.000Z',
      );
    });
  });

  describe('BEFORE offset — CERTIFIED_QUESTION_NOTICE counts back from the hearing', () => {
    it('base 5 BEFORE subtracts 5 calendar days from the hearing', () => {
      const rules = [
        rule({ milestoneKey: 'CERTIFIED_QUESTION_NOTICE', baseDays: 5, offsetDirection: 'BEFORE' }),
      ];
      // 2025-06-23 (Mon) − 5 = 2025-06-18 (Wed, open).
      const m = matter({ hearingAt: d('2025-06-23') });
      const cq = find(computeDeadlines(m, rules), 'CERTIFIED_QUESTION_NOTICE')!;
      expect(cq.computedDueAt.toISOString()).toBe('2025-06-18T00:00:00.000Z');
      expect(cq.anchorField).toBe('hearingAt');
    });
  });

  describe('Rule 10 perfection fork (reasonsPleadedAsReceived)', () => {
    const perfRule = () => [rule({ milestoneKey: 'RULE_10_PERFECTION', baseDays: 30 })];

    it('true → anchored on aljrFiledAt', () => {
      const m = matter({
        reasonsPleadedAsReceived: true,
        aljrFiledAt: d('2025-04-01'),
        rule9ResponseAt: d('2025-05-01'),
      });
      const p = find(computeDeadlines(m, perfRule()), 'RULE_10_PERFECTION')!;
      expect(p.anchorField).toBe('aljrFiledAt');
      expect(p.anchorDate.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    });

    it('false → anchored on rule9ResponseAt', () => {
      const m = matter({
        reasonsPleadedAsReceived: false,
        aljrFiledAt: d('2025-04-01'),
        rule9ResponseAt: d('2025-05-01'),
      });
      const p = find(computeDeadlines(m, perfRule()), 'RULE_10_PERFECTION')!;
      expect(p.anchorField).toBe('rule9ResponseAt');
      expect(p.anchorDate.toISOString()).toBe('2025-05-01T00:00:00.000Z');
    });

    it('false with a null rule9ResponseAt → no perfection deadline (skipped, no throw)', () => {
      const m = matter({
        reasonsPleadedAsReceived: false,
        aljrFiledAt: d('2025-04-01'),
        rule9ResponseAt: null,
      });
      const out = computeDeadlines(m, perfRule());
      expect(find(out, 'RULE_10_PERFECTION')).toBeUndefined();
    });
  });

  describe('No matching rule → skip', () => {
    it('a present anchor with no matching rule row yields no deadline and does not throw', () => {
      const m = matter({ respondentMemoServedAt: d('2025-03-03') });
      const out = computeDeadlines(m, []); // no rules at all
      expect(out).toHaveLength(0);
      expect(find(out, 'RULE_13_REPLY')).toBeUndefined();
    });
  });

  describe('toLegalDateUtc — an anchor is the STATED calendar day, never a drifted instant', () => {
    it('a bare YYYY-MM-DD maps to UTC midnight of that day', () => {
      expect(toLegalDateUtc('2026-05-14').toISOString()).toBe('2026-05-14T00:00:00.000Z');
    });

    it('a zoned evening timestamp keeps the stated day (no forward UTC drift)', () => {
      // 2026-05-14T20:00-04:00 is 2026-05-15T00:00Z — a raw `new Date` would drift a
      // day LATER (the dangerous direction). We keep the stated 2026-05-14.
      expect(toLegalDateUtc('2026-05-14T20:00:00-04:00').toISOString()).toBe(
        '2026-05-14T00:00:00.000Z',
      );
    });

    it('a UTC timestamp truncates to its own day', () => {
      expect(toLegalDateUtc('2026-05-14T09:30:00.000Z').toISOString()).toBe(
        '2026-05-14T00:00:00.000Z',
      );
    });
  });

  describe('computeDeadlinesDetailed — a FATAL milestone with no rule is reported, never silent', () => {
    it('ALJR_FILING applies with an anchor but no rule → listed in unmatchedFatal', () => {
      const m = matter({
        decidingOfficeLocation: 'OUTSIDE_CANADA',
        decisionCommunicatedAt: d('2025-05-14'),
      });
      const { deadlines, unmatchedFatal } = computeDeadlinesDetailed(m, []); // no rules at all
      expect(find(deadlines, 'ALJR_FILING')).toBeUndefined();
      expect(unmatchedFatal).toContain('ALJR_FILING');
    });

    it('a non-fatal milestone with no rule is skipped WITHOUT being flagged fatal', () => {
      const m = matter({ respondentMemoServedAt: d('2025-03-03') }); // RULE_13_REPLY — not fatal
      expect(computeDeadlinesDetailed(m, []).unmatchedFatal).toHaveLength(0);
    });

    it('when the fatal rule IS present, unmatchedFatal is empty', () => {
      const m = matter({
        decidingOfficeLocation: 'OUTSIDE_CANADA',
        decisionCommunicatedAt: d('2025-05-14'),
      });
      expect(computeDeadlinesDetailed(m, ALJR_RULES).unmatchedFatal).toHaveLength(0);
    });
  });

  describe('AUTO_COMPUTED_MILESTONE_KEYS — the recompute retirement scope', () => {
    it('covers the fatal + referral milestones and excludes endpoint-only rows', () => {
      expect(AUTO_COMPUTED_MILESTONE_KEYS).toEqual(
        expect.arrayContaining(['ALJR_FILING', 'RULE_10_PERFECTION', 'IAD_APPEAL', 'RAD_APPEAL']),
      );
      // UNDERLYING_DOC_EXPIRY is endpoint-created — a recompute must never retire it.
      expect(AUTO_COMPUTED_MILESTONE_KEYS).not.toContain('UNDERLYING_DOC_EXPIRY');
      // FCA_SERVICE has no anchor field yet — not auto-computed.
      expect(AUTO_COMPUTED_MILESTONE_KEYS).not.toContain('FCA_SERVICE');
    });
  });
});
