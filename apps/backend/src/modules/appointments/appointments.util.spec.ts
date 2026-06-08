import {
  appointmentEnd,
  computeFreeSlots,
  intervalsOverlap,
  pktWorkingWindowUtc,
} from './appointments.util';

describe('appointments.util', () => {
  describe('intervalsOverlap (half-open)', () => {
    const d = (s: string) => new Date(s);
    it('detects overlap', () => {
      expect(
        intervalsOverlap(
          d('2026-06-08T10:00:00Z'),
          d('2026-06-08T10:30:00Z'),
          d('2026-06-08T10:15:00Z'),
          d('2026-06-08T10:45:00Z'),
        ),
      ).toBe(true);
    });
    it('treats touching edges as non-overlapping', () => {
      expect(
        intervalsOverlap(
          d('2026-06-08T10:00:00Z'),
          d('2026-06-08T10:30:00Z'),
          d('2026-06-08T10:30:00Z'),
          d('2026-06-08T11:00:00Z'),
        ),
      ).toBe(false);
    });
    it('non-overlapping when disjoint', () => {
      expect(
        intervalsOverlap(
          d('2026-06-08T10:00:00Z'),
          d('2026-06-08T10:30:00Z'),
          d('2026-06-08T11:00:00Z'),
          d('2026-06-08T11:30:00Z'),
        ),
      ).toBe(false);
    });
  });

  describe('appointmentEnd', () => {
    it('adds the duration', () => {
      expect(appointmentEnd(new Date('2026-06-08T10:00:00Z'), 45).toISOString()).toBe(
        '2026-06-08T10:45:00.000Z',
      );
    });
  });

  describe('pktWorkingWindowUtc', () => {
    it('maps 09:00–18:00 PKT to 04:00–13:00 UTC', () => {
      const w = pktWorkingWindowUtc('2026-06-08');
      expect(w.start.toISOString()).toBe('2026-06-08T04:00:00.000Z');
      expect(w.end.toISOString()).toBe('2026-06-08T13:00:00.000Z');
    });
  });

  describe('computeFreeSlots', () => {
    it('returns full grid when nothing is busy', () => {
      const w = pktWorkingWindowUtc('2026-06-08'); // 9 hours
      const slots = computeFreeSlots(w.start, w.end, [], 30);
      expect(slots).toHaveLength(18); // 9h / 30m
    });
    it('removes slots overlapping a busy interval', () => {
      const w = pktWorkingWindowUtc('2026-06-08');
      // Busy 10:00–11:00 PKT == 05:00–06:00 UTC blocks two 30-min slots.
      const busy = [
        { start: new Date('2026-06-08T05:00:00Z'), end: new Date('2026-06-08T06:00:00Z') },
      ];
      const slots = computeFreeSlots(w.start, w.end, busy, 30);
      expect(slots).toHaveLength(16);
      expect(
        slots.some((s) => intervalsOverlap(s.start, s.end, busy[0].start, busy[0].end)),
      ).toBe(false);
    });
    it('only includes slots that fit entirely in the window', () => {
      const start = new Date('2026-06-08T09:00:00Z');
      const end = new Date('2026-06-08T09:50:00Z'); // 50 min → one 30-min slot fits
      expect(computeFreeSlots(start, end, [], 30)).toHaveLength(1);
    });
  });
});
