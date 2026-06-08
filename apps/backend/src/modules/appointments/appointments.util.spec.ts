import {
  appointmentEnd,
  computeFreeSlots,
  firstFreeSlot,
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

  // The shared "roll forward to the next open slot" search used by BOTH the
  // WhatsApp bot (conflict:'advance') and the web's reject-with-suggestion path.
  describe('firstFreeSlot', () => {
    const ms = (iso: string) => new Date(iso).getTime();
    const identity = (d: Date) => d; // isolate the slot math from any office-hours policy
    const DUR = 30 * 60_000;

    it('returns the desired time when the rep is free', () => {
      const out = firstFreeSlot(new Date('2026-06-08T10:00:00Z'), DUR, [], identity);
      expect(out.toISOString()).toBe('2026-06-08T10:00:00.000Z');
    });

    it('rolls forward 30 min when the desired slot is taken', () => {
      const busy = [{ s: ms('2026-06-08T10:00:00Z'), e: ms('2026-06-08T10:30:00Z') }];
      const out = firstFreeSlot(new Date('2026-06-08T10:00:00Z'), DUR, busy, identity);
      expect(out.toISOString()).toBe('2026-06-08T10:30:00.000Z');
    });

    it('skips multiple consecutive busy slots', () => {
      const busy = [
        { s: ms('2026-06-08T10:00:00Z'), e: ms('2026-06-08T10:30:00Z') },
        { s: ms('2026-06-08T10:30:00Z'), e: ms('2026-06-08T11:00:00Z') },
      ];
      const out = firstFreeSlot(new Date('2026-06-08T10:00:00Z'), DUR, busy, identity);
      expect(out.toISOString()).toBe('2026-06-08T11:00:00.000Z');
    });

    it('treats a busy interval that only touches the edge as free (half-open)', () => {
      // busy 09:30–10:00 touches desired 10:00 at the edge → 10:00 stays free.
      const busy = [{ s: ms('2026-06-08T09:30:00Z'), e: ms('2026-06-08T10:00:00Z') }];
      const out = firstFreeSlot(new Date('2026-06-08T10:00:00Z'), DUR, busy, identity);
      expect(out.toISOString()).toBe('2026-06-08T10:00:00.000Z');
    });

    it('applies the injected clamp to each candidate', () => {
      // Clamp that pushes any time before 11:00Z up to 11:00Z — proves the
      // office-hours policy is honoured by the search, not hard-coded.
      const clampTo11 = (d: Date) =>
        d.getTime() < ms('2026-06-08T11:00:00Z') ? new Date('2026-06-08T11:00:00Z') : d;
      const out = firstFreeSlot(new Date('2026-06-08T08:00:00Z'), DUR, [], clampTo11);
      expect(out.toISOString()).toBe('2026-06-08T11:00:00.000Z');
    });
  });
});
