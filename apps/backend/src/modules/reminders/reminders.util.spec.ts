import {
  APPT_LEAD_MINUTES,
  apptDedupeKey,
  apptReminderContent,
  followupDueContent,
  followupDueDedupeKey,
  minutesAway,
  overdueDigestContent,
  overdueDigestKey,
  pktDateString,
  pktHour,
  reminderRunAt,
  startOfPktDayUtc,
} from './reminders.util';

describe('reminders.util', () => {
  describe('reminderRunAt', () => {
    it('fires APPT_LEAD_MINUTES before the appointment by default', () => {
      const sched = new Date('2026-06-08T10:00:00.000Z');
      const run = reminderRunAt(sched);
      expect(sched.getTime() - run.getTime()).toBe(APPT_LEAD_MINUTES * 60_000);
    });
    it('honours a custom lead time', () => {
      const sched = new Date('2026-06-08T10:00:00.000Z');
      expect(reminderRunAt(sched, 30).toISOString()).toBe('2026-06-08T09:30:00.000Z');
    });
  });

  describe('dedupe keys', () => {
    it('are stable and namespaced per source + reminder type', () => {
      expect(apptDedupeKey('a1')).toBe('appt:a1');
      expect(followupDueDedupeKey('f1')).toBe('followup-due:f1');
      expect(overdueDigestKey('u1', '2026-06-08')).toBe('followup-overdue:u1:2026-06-08');
    });
  });

  describe('PKT day/hour math (fixed UTC+5, no DST)', () => {
    it('pktDateString rolls to the next day once past 19:00 UTC', () => {
      // 19:00 UTC == 00:00 PKT next day
      expect(pktDateString(new Date('2026-06-07T18:59:00.000Z'))).toBe('2026-06-07');
      expect(pktDateString(new Date('2026-06-07T19:00:00.000Z'))).toBe('2026-06-08');
    });
    it('pktHour converts to the Karachi clock hour', () => {
      expect(pktHour(new Date('2026-06-07T03:00:00.000Z'))).toBe(8); // 08:00 PKT
      expect(pktHour(new Date('2026-06-07T20:00:00.000Z'))).toBe(1); // 01:00 PKT next day
    });
    it('startOfPktDayUtc returns midnight-PKT as a UTC instant', () => {
      // For any instant on PKT day 2026-06-08, midnight PKT == 19:00 UTC prior day.
      expect(startOfPktDayUtc(new Date('2026-06-08T05:00:00.000Z')).toISOString()).toBe(
        '2026-06-07T19:00:00.000Z',
      );
      // An instant whose UTC date already reads 06-08 but is still 06-08 in PKT
      expect(startOfPktDayUtc(new Date('2026-06-07T20:00:00.000Z')).toISOString()).toBe(
        '2026-06-07T19:00:00.000Z',
      );
    });
  });

  describe('minutesAway', () => {
    it('rounds to whole minutes', () => {
      const now = new Date('2026-06-08T10:00:00.000Z');
      expect(minutesAway(new Date('2026-06-08T10:09:40.000Z'), now)).toBe(10);
    });
    it('floors at 1 (never "in 0 min")', () => {
      const now = new Date('2026-06-08T10:00:00.000Z');
      expect(minutesAway(new Date('2026-06-08T10:00:05.000Z'), now)).toBe(1);
      expect(minutesAway(new Date('2026-06-08T09:55:00.000Z'), now)).toBe(1);
    });
  });

  describe('notification copy', () => {
    it('appointment reminder leads with minutes + party + PKT time', () => {
      const now = new Date('2026-06-08T09:50:00.000Z');
      const c = apptReminderContent({
        title: 'Consultation',
        who: 'Asad',
        scheduledAt: new Date('2026-06-08T10:00:00.000Z'),
        now,
      });
      expect(c.title).toBe('Starting in 10 min: Consultation');
      expect(c.body).toContain('With Asad');
      expect(c.body).toContain('PKT');
    });
    it('follow-up due copy names the lead', () => {
      const c = followupDueContent({ title: 'Call back re: study visa', who: 'Sara' });
      expect(c.title).toBe('Follow-up due: Call back re: study visa');
      expect(c.body).toBe('With Sara');
    });
    it('overdue digest pluralises correctly', () => {
      expect(overdueDigestContent(1).title).toBe('1 follow-up overdue');
      expect(overdueDigestContent(3).title).toBe('3 follow-ups overdue');
    });
  });
});
