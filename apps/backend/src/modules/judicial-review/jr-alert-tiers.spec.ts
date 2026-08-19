import { configKeyForDeadline, resolveActiveTier } from './jr-alert-tiers';

describe('jr-alert-tiers', () => {
  describe('resolveActiveTier — no blast on late creation', () => {
    it('a deadline created at T-3 fires only T-3, not the earlier tiers', () => {
      const active = resolveActiveTier('RULE_10_PERFECTION', 3);
      expect(active).not.toBeNull();
      expect(active?.tier).toBe('T-3'); // not T-30 / T-14 / T-7
    });
  });

  describe('resolveActiveTier — countdown fires each tier once', () => {
    const cases: Array<[number, string]> = [
      [8, 'T-15'],
      [7, 'T-7'],
      [5, 'T-5'],
      [3, 'T-3'],
      [1, 'T-1'],
      [0, 'T-1'],
    ];
    it.each(cases)('ALJR_FILING_60 at daysUntil %i → %s', (daysUntil, tier) => {
      expect(resolveActiveTier('ALJR_FILING_60', daysUntil)?.tier).toBe(tier);
    });

    it('ALJR_FILING_60 at daysUntil -1 → OVERDUE', () => {
      expect(resolveActiveTier('ALJR_FILING_60', -1)?.tier).toBe('OVERDUE');
    });
  });

  describe('resolveActiveTier — too early', () => {
    it('ALJR_FILING_60 at daysUntil 50 → null (max threshold 45 < 50)', () => {
      expect(resolveActiveTier('ALJR_FILING_60', 50)).toBeNull();
    });
  });

  describe('configKeyForDeadline — track selection', () => {
    it('a 60-ish-day gap → ALJR_FILING_60', () => {
      expect(
        configKeyForDeadline({
          milestoneKey: 'ALJR_FILING',
          anchorDate: new Date('2025-05-14T00:00:00Z'),
          computedDueAt: new Date('2025-07-14T00:00:00Z'),
        }),
      ).toBe('ALJR_FILING_60');
    });

    it('a 15-day gap → ALJR_FILING_15', () => {
      expect(
        configKeyForDeadline({
          milestoneKey: 'ALJR_FILING',
          anchorDate: new Date('2025-05-14T00:00:00Z'),
          computedDueAt: new Date('2025-05-29T00:00:00Z'),
        }),
      ).toBe('ALJR_FILING_15');
    });

    it('a non-ALJR milestone passes through unchanged', () => {
      expect(
        configKeyForDeadline({
          milestoneKey: 'RULE_10_PERFECTION',
          anchorDate: new Date('2025-05-14T00:00:00Z'),
          computedDueAt: new Date('2025-06-28T00:00:00Z'),
        }),
      ).toBe('RULE_10_PERFECTION');
    });
  });

  describe('resolveActiveTier — minor milestones have no OVERDUE', () => {
    it('PROOF_OF_SERVICE at daysUntil -1 → null', () => {
      expect(resolveActiveTier('PROOF_OF_SERVICE', -1)).toBeNull();
    });
  });

  describe('resolveActiveTier — unknown milestone', () => {
    it('RULE_11_RESPONDENT_RECORD (absent from policy) → null', () => {
      expect(resolveActiveTier('RULE_11_RESPONDENT_RECORD', 1)).toBeNull();
    });
  });
});
