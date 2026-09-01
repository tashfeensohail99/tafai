import { startOfPktDayUtc, cappedOutEmployeeIds } from './daily-lead-cap';

describe('startOfPktDayUtc', () => {
  it('returns PKT (UTC+5) midnight as a UTC instant', () => {
    // 2026-09-02T10:00Z == 15:00 PKT Sep 2 → PKT day starts 2026-09-01T19:00Z.
    expect(startOfPktDayUtc(new Date('2026-09-02T10:00:00Z')).toISOString()).toBe('2026-09-01T19:00:00.000Z');
  });

  it('uses the PKT calendar day, not the server-UTC day (late-evening boundary)', () => {
    // 2026-09-01T18:30Z == 23:30 PKT Sep 1 (still Sep 1 in PKT) → 2026-08-31T19:00Z.
    expect(startOfPktDayUtc(new Date('2026-09-01T18:30:00Z')).toISOString()).toBe('2026-08-31T19:00:00.000Z');
  });

  it('handles just-after-PKT-midnight', () => {
    // 2026-09-01T19:30Z == 00:30 PKT Sep 2 → new PKT day already → 2026-09-01T19:00Z.
    expect(startOfPktDayUtc(new Date('2026-09-01T19:30:00Z')).toISOString()).toBe('2026-09-01T19:00:00.000Z');
  });
});

describe('cappedOutEmployeeIds', () => {
  const fakeDb = (rows: Array<{ assignedEmployeeId: string | null; _count: number }>) => ({
    lead: { groupBy: jest.fn().mockResolvedValue(rows) },
  });

  it('adds zero queries when no rep has a cap', async () => {
    const db = fakeDb([]);
    const out = await cappedOutEmployeeIds(db, [
      { id: 'a', dailyLeadCap: null },
      { id: 'b', dailyLeadCap: null },
    ]);
    expect(out.size).toBe(0);
    expect(db.lead.groupBy).not.toHaveBeenCalled();
  });

  it('drops a capped rep who has hit the cap', async () => {
    const db = fakeDb([{ assignedEmployeeId: 'b', _count: 7 }]);
    const out = await cappedOutEmployeeIds(db, [
      { id: 'a', dailyLeadCap: null },
      { id: 'b', dailyLeadCap: 7 },
    ]);
    expect([...out]).toEqual(['b']);
  });

  it('keeps a capped rep still under the cap', async () => {
    const db = fakeDb([{ assignedEmployeeId: 'b', _count: 6 }]);
    const out = await cappedOutEmployeeIds(db, [{ id: 'b', dailyLeadCap: 7 }]);
    expect(out.size).toBe(0);
  });

  it('treats a rep with no leads today (absent from the grouped rows) as under cap', async () => {
    const db = fakeDb([]);
    const out = await cappedOutEmployeeIds(db, [{ id: 'b', dailyLeadCap: 7 }]);
    expect(out.size).toBe(0);
  });

  it('never returns an uncapped rep even if they have many leads', async () => {
    const db = fakeDb([{ assignedEmployeeId: 'a', _count: 999 }]);
    const out = await cappedOutEmployeeIds(db, [
      { id: 'a', dailyLeadCap: null },
      { id: 'b', dailyLeadCap: 7 },
    ]);
    expect(out.has('a')).toBe(false);
  });

  it('cap of 0 means never (out immediately with no leads)', async () => {
    const db = fakeDb([]);
    const out = await cappedOutEmployeeIds(db, [{ id: 'b', dailyLeadCap: 0 }]);
    expect([...out]).toEqual(['b']);
  });
});
