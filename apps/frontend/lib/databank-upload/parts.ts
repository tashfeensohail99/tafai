/**
 * Part arithmetic for resumable uploads. The SERVER plans the parts (every
 * part `partSize` bytes except the last) and stores the plan on the session;
 * the browser only slices the file accordingly. Mirrors the backend's
 * upload-plan.ts expectedPartBytes.
 */

/** [start, end) byte range of 1-based `partNumber`. */
export function partRange(partNumber: number, partSize: number, sizeBytes: number): [number, number] {
  const start = (partNumber - 1) * partSize;
  return [start, Math.min(start + partSize, sizeBytes)];
}

export function partBytes(partNumber: number, partSize: number, sizeBytes: number): number {
  const [start, end] = partRange(partNumber, partSize, sizeBytes);
  return end - start;
}

/** Part numbers 1..partCount not in `done`, ascending. */
export function partsToSend(partCount: number, done: Iterable<number>): number[] {
  const have = new Set(done);
  const out: number[] = [];
  for (let n = 1; n <= partCount; n++) if (!have.has(n)) out.push(n);
  return out;
}

/** Total bytes of the given parts. */
export function bytesOf(parts: Iterable<number>, partSize: number, sizeBytes: number): number {
  let total = 0;
  for (const n of parts) total += partBytes(n, partSize, sizeBytes);
  return total;
}
