/**
 * Unit tests for the pure decision logic behind the paid-consultation flow:
 *   1. reminderOffsetFor  — the 24h / 2h reminder banding used by the sweeper.
 *   2. looksLikeImage     — the byte-signature guard on customer receipt uploads.
 *
 * Both are pure static functions — no PrismaService / DB / mocks required.
 */

import { ReceptionService } from './reception.service';

// looksLikeImage is private; reach it through a cast to keep encapsulation.
const looksLikeImage = (b: Buffer): boolean => (ReceptionService as any).looksLikeImage(b);

/** Build a buffer from leading bytes, right-padded with zeros to `len`. */
function bytes(head: number[], len = 16): Buffer {
  const b = Buffer.alloc(len);
  head.forEach((v, i) => (b[i] = v));
  return b;
}

describe('ReceptionService.reminderOffsetFor', () => {
  it('fires the 2h reminder only inside the (110, 125] band', () => {
    expect(ReceptionService.reminderOffsetFor(110)).toBeNull(); // lower bound is exclusive
    expect(ReceptionService.reminderOffsetFor(111)).toBe('2h');
    expect(ReceptionService.reminderOffsetFor(120)).toBe('2h');
    expect(ReceptionService.reminderOffsetFor(125)).toBe('2h'); // upper bound inclusive
    expect(ReceptionService.reminderOffsetFor(126)).toBeNull();
  });

  it('fires the 24h reminder only inside the (1420, 1445] band', () => {
    expect(ReceptionService.reminderOffsetFor(1420)).toBeNull();
    expect(ReceptionService.reminderOffsetFor(1421)).toBe('24h');
    expect(ReceptionService.reminderOffsetFor(1440)).toBe('24h');
    expect(ReceptionService.reminderOffsetFor(1445)).toBe('24h');
    expect(ReceptionService.reminderOffsetFor(1446)).toBeNull();
  });

  it('returns null between the bands and for past/near appointments', () => {
    expect(ReceptionService.reminderOffsetFor(0)).toBeNull();
    expect(ReceptionService.reminderOffsetFor(60)).toBeNull(); // 1h out — no reminder
    expect(ReceptionService.reminderOffsetFor(300)).toBeNull(); // 5h out — between bands
    expect(ReceptionService.reminderOffsetFor(-30)).toBeNull(); // already started
    expect(ReceptionService.reminderOffsetFor(5000)).toBeNull(); // days away
  });
});

describe('ReceptionService.looksLikeImage', () => {
  it('accepts the image formats we allow', () => {
    expect(looksLikeImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe(true); // JPEG
    expect(looksLikeImage(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true); // PNG
    expect(looksLikeImage(Buffer.from('GIF89a' + '\0'.repeat(10)))).toBe(true); // GIF
    expect(looksLikeImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe(true); // WebP
    expect(looksLikeImage(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(4)]))).toBe(true); // HEIC
  });

  it('rejects a spoofed non-image (PDF / HTML / text)', () => {
    expect(looksLikeImage(Buffer.from('%PDF-1.7\n%âãÏÓ'))).toBe(false);
    expect(looksLikeImage(Buffer.from('<!DOCTYPE html><html></html>'))).toBe(false);
    expect(looksLikeImage(Buffer.from('just some plain text here'))).toBe(false);
  });

  it('rejects buffers that are empty or too short to classify', () => {
    expect(looksLikeImage(Buffer.alloc(0))).toBe(false);
    expect(looksLikeImage(Buffer.from([0xff, 0xd8]))).toBe(false); // <12 bytes
    expect(looksLikeImage(undefined as any)).toBe(false);
  });

  it('does not treat a RIFF container that is not WEBP (e.g. WAV) as an image', () => {
    expect(looksLikeImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]))).toBe(false);
  });
});
