import { pickRoundRobin, poolKeyOf } from './assignment.service';

const desk = (ids: string[]) => ids.map((id) => ({ id }));

describe('pickRoundRobin', () => {
  const pool = desk(['a', 'b', 'c']); // sorted ascending, mirrors `orderBy id asc`

  it('starts at pool[0] when there is no cursor', () => {
    expect(pickRoundRobin(pool, null).id).toBe('a');
  });

  it('picks the next id strictly after the cursor', () => {
    expect(pickRoundRobin(pool, 'a').id).toBe('b');
    expect(pickRoundRobin(pool, 'b').id).toBe('c');
  });

  it('wraps to pool[0] when the cursor is at or past the last id', () => {
    expect(pickRoundRobin(pool, 'c').id).toBe('a');
    expect(pickRoundRobin(pool, 'zzz').id).toBe('a'); // cursor above max id → wrap
  });

  it('rotates every member exactly once per cycle when advancing its OWN cursor', () => {
    // This is the per-desk cursor behaviour: feed each pick back as the cursor.
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    let cursor: string | null = null;
    for (let i = 0; i < 9; i++) {
      const picked: { id: string } = pickRoundRobin(pool, cursor);
      counts[picked.id]++;
      cursor = picked.id; // advance the desk's OWN cursor
    }
    expect(counts).toEqual({ a: 3, b: 3, c: 3 }); // perfectly even
  });

  it('starves the desk when a SHARED cursor jumps around (the bug this fix removes)', () => {
    // The single global cursor is moved by OTHER pools/channels to arbitrary ids
    // between each of this desk's picks, so the desk never advances cleanly and
    // keeps collapsing to pool[0].
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const sharedCursorLandings = ['c', 'zzz', 'c', 'zzz', 'c', 'zzz']; // all wrap to 'a'
    for (const cursor of sharedCursorLandings) counts[pickRoundRobin(pool, cursor).id]++;
    expect(counts.a).toBeGreaterThan(counts.b);
    expect(counts.c).toBe(0); // 'c' (Zobia-like) starved entirely
  });
});

describe('poolKeyOf', () => {
  it('is order-independent — one desk, any ordering, shares one cursor', () => {
    expect(poolKeyOf(['a', 'b', 'c'])).toBe(poolKeyOf(['c', 'a', 'b']));
  });

  it('re-keys when membership changes (restarts that desk cleanly)', () => {
    expect(poolKeyOf(['a', 'b', 'c'])).not.toBe(poolKeyOf(['a', 'b', 'c', 'd']));
  });

  it('gives different desks different cursors', () => {
    expect(poolKeyOf(['lahore1', 'lahore2'])).not.toBe(poolKeyOf(['isb1', 'isb2']));
  });
});
