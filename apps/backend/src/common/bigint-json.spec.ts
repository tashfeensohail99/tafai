import './bigint-json';

describe('bigint-json', () => {
  it('serializes a databank tree with a multi-GB BigInt file size as a plain number', () => {
    const twelveGb = 12n * 1024n * 1024n * 1024n; // 12,884,901,888 — beyond int4
    const tree = {
      clientId: 'c1',
      folders: [],
      files: [
        { id: 'f1', fileName: 'drive-export.zip', fileSizeBytes: twelveGb },
        { id: 'f2', fileName: 'passport.pdf', fileSizeBytes: 482_113n },
        { id: 'f3', fileName: 'legacy.pdf', fileSizeBytes: null },
      ],
    };

    const parsed = JSON.parse(JSON.stringify(tree));

    expect(parsed.files[0].fileSizeBytes).toBe(12_884_901_888);
    expect(typeof parsed.files[0].fileSizeBytes).toBe('number');
    expect(parsed.files[1].fileSizeBytes).toBe(482_113);
    expect(parsed.files[2].fileSizeBytes).toBeNull();
  });

  it('leaves non-BigInt values untouched', () => {
    const value = { n: 5, s: 'x', b: true, arr: [1, 'a'], nested: { d: 2.5 } };
    expect(JSON.stringify(value)).toBe('{"n":5,"s":"x","b":true,"arr":[1,"a"],"nested":{"d":2.5}}');
  });

  it('is exact up to Number.MAX_SAFE_INTEGER', () => {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    expect(JSON.parse(JSON.stringify({ v: max })).v).toBe(Number.MAX_SAFE_INTEGER);
  });
});
