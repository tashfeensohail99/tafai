/**
 * Incremental SHA-256 (FIPS 180-4) for hashing multi-GB files in a Web Worker.
 *
 * WebCrypto's `crypto.subtle.digest` is one-shot — it needs the WHOLE file in
 * memory, impossible for a 25 GB Drive export — so the databank uploader feeds
 * the file through this in chunks instead. Pure TypeScript, no dependency;
 * runs ~200+ MB/s in V8, far above a typical upload link, and off the main
 * thread. The server uses the hash to spot files it already has (dedupe) and
 * to recognise the same file when an upload resumes.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 {
  private readonly h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly w = new Uint32Array(64);
  private readonly block = new Uint8Array(64);
  private blockLen = 0;
  /** Total bytes fed (a double: exact up to 2^53, i.e. 8 PiB). */
  private length = 0;
  private done = false;

  update(data: Uint8Array): this {
    if (this.done) throw new Error('Sha256: update() after digest()');
    this.length += data.length;
    this.absorb(data);
    return this;
  }

  /** Finish and return the lower-case hex digest (the instance is then spent). */
  digestHex(): string {
    if (this.done) throw new Error('Sha256: digest() called twice');
    this.done = true;
    const bits = this.length * 8;
    const pad = new Uint8Array(((this.blockLen < 56 ? 56 : 120) - this.blockLen) + 8);
    pad[0] = 0x80;
    // 64-bit big-endian bit length. `bits` < 2^56, so split exactly.
    const hi = Math.floor(bits / 0x100000000);
    const lo = bits % 0x100000000;
    const n = pad.length;
    pad[n - 8] = hi >>> 24; pad[n - 7] = hi >>> 16; pad[n - 6] = hi >>> 8; pad[n - 5] = hi;
    pad[n - 4] = lo >>> 24; pad[n - 3] = lo >>> 16; pad[n - 2] = lo >>> 8; pad[n - 1] = lo;
    this.absorb(pad);
    let hex = '';
    for (let j = 0; j < 8; j++) hex += this.h[j].toString(16).padStart(8, '0');
    return hex;
  }

  /** Feed bytes through the 64-byte block buffer. */
  private absorb(data: Uint8Array): void {
    let i = 0;
    if (this.blockLen > 0) {
      const take = Math.min(64 - this.blockLen, data.length);
      this.block.set(data.subarray(0, take), this.blockLen);
      this.blockLen += take;
      i = take;
      if (this.blockLen < 64) return;
      this.compress(this.block, 0);
      this.blockLen = 0;
    }
    for (; i + 64 <= data.length; i += 64) this.compress(data, i);
    if (i < data.length) {
      this.block.set(data.subarray(i), 0);
      this.blockLen = data.length - i;
    }
  }

  private compress(p: Uint8Array, off: number): void {
    const w = this.w;
    for (let t = 0; t < 16; t++) {
      const o = off + t * 4;
      w[t] = (p[o] << 24) | (p[o + 1] << 16) | (p[o + 2] << 8) | p[o + 3];
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    const h = this.h;
    let a = h[0] | 0, b = h[1] | 0, c = h[2] | 0, d = h[3] | 0;
    let e = h[4] | 0, f = h[5] | 0, g = h[6] | 0, k = h[7] | 0;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (k + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d;
    h[4] += e; h[5] += f; h[6] += g; h[7] += k;
  }
}
