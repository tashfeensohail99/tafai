import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Sha256 } from './sha256.ts';

const ref = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const enc = (s: string) => new TextEncoder().encode(s);

test('known vectors', () => {
  assert.equal(new Sha256().digestHex(), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(new Sha256().update(enc('abc')).digestHex(), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    new Sha256().update(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).digestHex(),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('every length around the padding boundaries matches node:crypto', () => {
  const data = randomBytes(300);
  for (let n = 0; n <= 300; n++) assert.equal(new Sha256().update(data.subarray(0, n)).digestHex(), ref(data.subarray(0, n)), `n=${n}`);
});

test('chunking never changes the digest (random split points)', () => {
  const data = randomBytes(1 << 20);
  for (let round = 0; round < 20; round++) {
    const h = new Sha256();
    let i = 0;
    while (i < data.length) {
      const step = Math.min(data.length - i, 1 + Math.floor(Math.random() * (round % 2 ? 97 : 70_000)));
      h.update(data.subarray(i, i + step));
      i += step;
    }
    assert.equal(h.digestHex(), ref(data));
  }
});

test('one million "a" (FIPS long vector)', () => {
  const h = new Sha256();
  const chunk = new Uint8Array(1000).fill(0x61);
  for (let i = 0; i < 1000; i++) h.update(chunk);
  assert.equal(h.digestHex(), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('refuses reuse after digest', () => {
  const h = new Sha256();
  h.digestHex();
  assert.throws(() => h.update(enc('x')));
  assert.throws(() => h.digestHex());
});

test('throughput is well above an upload link (informational)', () => {
  const data = randomBytes(64 << 20);
  const t = performance.now();
  new Sha256().update(data).digestHex();
  const mbps = 64 / ((performance.now() - t) / 1000);
  console.log(`sha256: ${mbps.toFixed(0)} MB/s`);
  assert.ok(mbps > 30);
});
