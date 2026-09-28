import {
  DEFAULT_MAX_UPLOAD_BYTES,
  GiB,
  MiB,
  R2_MAX_OBJECT_BYTES,
  R2_MAX_PARTS,
  R2_MAX_PART_BYTES,
  R2_MIN_PART_BYTES,
  SINGLE_PUT_MAX_BYTES,
  assertValidPlan,
  expectedPartBytes,
  exceedsUploadCap,
  planParts,
  resolveMaxUploadBytes,
  verifyParts,
  type ListedPart,
} from './upload-plan';

type Multi = { sizeBytes: number; partSize: number; partCount: number };
const multi = (size: number): Multi => {
  const p = planParts(size);
  if (p.strategy !== 'MULTIPART') throw new Error(`expected MULTIPART for ${size}`);
  return p;
};
/** Every part of a plan, as R2 would list it after a perfect upload. */
const allParts = (plan: Multi): ListedPart[] =>
  Array.from({ length: plan.partCount }, (_, i) => ({
    partNumber: i + 1,
    etag: `"etag-${i + 1}"`,
    sizeBytes: expectedPartBytes(plan, i + 1),
  }));

describe('planParts', () => {
  it('uses a single PUT for 0 B, 1 B and exactly 32 MiB', () => {
    expect(planParts(0)).toEqual({ strategy: 'SINGLE', sizeBytes: 0 });
    expect(planParts(1)).toEqual({ strategy: 'SINGLE', sizeBytes: 1 });
    expect(planParts(SINGLE_PUT_MAX_BYTES)).toEqual({ strategy: 'SINGLE', sizeBytes: 32 * MiB });
  });

  it('switches to multipart at 32 MiB + 1 with 8 MiB parts', () => {
    const p = multi(32 * MiB + 1);
    expect(p.partSize).toBe(8 * MiB);
    expect(p.partCount).toBe(5); // 4 full parts + a 1-byte last part
  });

  it('plans 10 GiB as 1,280 × 8 MiB and 100 GiB as 8,534 × 12 MiB (design §3)', () => {
    expect(multi(10 * GiB)).toMatchObject({ partSize: 8 * MiB, partCount: 1280 });
    expect(multi(100 * GiB)).toMatchObject({ partSize: 12 * MiB, partCount: 8534 });
  });

  it('always yields an R2-valid plan: equal parts, last part in range, ≤ 10,000 parts', () => {
    const sizes = [
      32 * MiB + 1, 1 * GiB + 7, 10 * GiB, 49 * GiB + 123, 100 * GiB, 1024 * GiB,
      9000 * 8 * MiB, 9000 * 8 * MiB + 1, // the 8 MiB → 9 MiB part-size boundary
      R2_MAX_OBJECT_BYTES - 1, R2_MAX_OBJECT_BYTES, // the largest plannable sizes
    ];
    for (const size of sizes) {
      const p = multi(size);
      const last = expectedPartBytes(p, p.partCount);
      expect(p.partCount).toBeLessThanOrEqual(R2_MAX_PARTS);
      expect(p.partSize % MiB).toBe(0);
      expect(p.partSize).toBeGreaterThanOrEqual(R2_MIN_PART_BYTES);
      expect(p.partSize).toBeLessThanOrEqual(R2_MAX_PART_BYTES);
      expect(() => assertValidPlan(p)).not.toThrow();
      expect(last).toBeGreaterThan(0);
      expect(last).toBeLessThanOrEqual(p.partSize);
      expect((p.partCount - 1) * p.partSize + last).toBe(size);
    }
  });

  it('rejects negative, fractional, unsafe and beyond-storage sizes', () => {
    expect(() => planParts(-1)).toThrow(RangeError);
    expect(() => planParts(1.5)).toThrow(RangeError);
    expect(() => planParts(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => planParts(R2_MAX_OBJECT_BYTES + 1)).toThrow(RangeError);
  });
});

describe('assertValidPlan', () => {
  it('rejects malformed stored plans instead of letting verifyParts pass them', () => {
    const good = multi(40 * MiB); // 5 × 8 MiB
    expect(() => assertValidPlan(good)).not.toThrow();
    expect(() => assertValidPlan({ ...good, partCount: 0 })).toThrow(RangeError);
    expect(() => assertValidPlan({ ...good, partCount: Number.NaN })).toThrow(RangeError);
    expect(() => assertValidPlan({ ...good, partSize: 1 * MiB })).toThrow(RangeError); // < R2 min
    expect(() => assertValidPlan({ ...good, sizeBytes: 100 * MiB })).toThrow(RangeError); // doesn't fit
    expect(() => assertValidPlan({ ...good, sizeBytes: 32 * MiB })).toThrow(RangeError); // last part empty
    expect(() => verifyParts({ ...good, partCount: 0 }, [])).toThrow(RangeError);
  });
});

describe('upload cap', () => {
  it('flags cap + 1 and allows exactly the cap', () => {
    expect(exceedsUploadCap(DEFAULT_MAX_UPLOAD_BYTES)).toBe(false);
    expect(exceedsUploadCap(DEFAULT_MAX_UPLOAD_BYTES + 1)).toBe(true);
    expect(exceedsUploadCap(10 * GiB, 5 * GiB)).toBe(true);
  });

  it('resolves the env cap, falling back to 50 GiB on missing/invalid values', () => {
    expect(resolveMaxUploadBytes(undefined)).toBe(50 * GiB);
    expect(resolveMaxUploadBytes('abc')).toBe(50 * GiB);
    expect(resolveMaxUploadBytes('-5')).toBe(50 * GiB);
    expect(resolveMaxUploadBytes(String(100 * GiB))).toBe(100 * GiB);
  });

  it('clamps a huge env cap to what storage + the planner can actually hold', () => {
    const cap = resolveMaxUploadBytes(String(Number.MAX_SAFE_INTEGER));
    expect(cap).toBe(R2_MAX_OBJECT_BYTES);
    expect(() => planParts(cap)).not.toThrow(); // every allowed size is plannable
  });
});

describe('verifyParts', () => {
  const plan = multi(10 * GiB + 3 * MiB); // 1,281 parts, last = 3 MiB

  it('accepts a complete upload and returns parts 1..N sorted with ETags verbatim', () => {
    const shuffled = [...allParts(plan)].reverse();
    const v = verifyParts(plan, shuffled);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.completeParts).toHaveLength(plan.partCount);
    expect(v.completeParts[0]).toEqual({ partNumber: 1, etag: '"etag-1"' }); // quotes kept
    expect(v.completeParts.map((p) => p.partNumber)).toEqual(
      Array.from({ length: plan.partCount }, (_, i) => i + 1),
    );
    expect(v.ignoredExtraParts).toEqual([]);
  });

  it('reports a missing part', () => {
    const parts = allParts(plan).filter((p) => p.partNumber !== 640);
    expect(verifyParts(plan, parts)).toEqual({ ok: false, missingParts: [640] });
  });

  it('reports a short MIDDLE part (size is enforced here, not at presign)', () => {
    const parts = allParts(plan).map((p) => (p.partNumber === 7 ? { ...p, sizeBytes: p.sizeBytes - 1 } : p));
    expect(verifyParts(plan, parts)).toEqual({ ok: false, missingParts: [7] });
  });

  it('reports a wrong-size LAST part', () => {
    const parts = allParts(plan).map((p) =>
      p.partNumber === plan.partCount ? { ...p, sizeBytes: p.sizeBytes + 1 } : p,
    );
    expect(verifyParts(plan, parts)).toEqual({ ok: false, missingParts: [plan.partCount] });
  });

  it('ignores extra parts beyond N (never sent on complete)', () => {
    const extra: ListedPart = { partNumber: plan.partCount + 5, etag: '"x"', sizeBytes: 1 };
    const v = verifyParts(plan, [...allParts(plan), extra]);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.completeParts).toHaveLength(plan.partCount);
    expect(v.ignoredExtraParts).toEqual([plan.partCount + 5]);
  });

  it('reports everything missing when R2 holds nothing, and parts without an ETag', () => {
    const small = multi(40 * MiB); // 5 parts
    expect(verifyParts(small, [])).toEqual({ ok: false, missingParts: [1, 2, 3, 4, 5] });
    const noEtag = allParts(small).map((p) => (p.partNumber === 2 ? { ...p, etag: '' } : p));
    expect(verifyParts(small, noEtag)).toEqual({ ok: false, missingParts: [2] });
  });

  it('works on the flattened result of multiple ListParts pages', () => {
    const all = allParts(plan);
    const pages = [all.slice(0, 1000), all.slice(1000)]; // R2 pages at 1,000
    expect(verifyParts(plan, pages.flat()).ok).toBe(true);
  });
});
