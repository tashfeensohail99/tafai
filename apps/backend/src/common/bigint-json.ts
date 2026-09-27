/**
 * Make BigInt JSON-serializable, process-wide.
 *
 * Prisma returns `BigInt` columns (e.g. DatabankFile.fileSizeBytes, widened
 * because files can exceed an int4's ~2.1 GB) as JS `bigint`, and
 * `JSON.stringify` THROWS on bigint ("Do not know how to serialize a BigInt") —
 * which would turn every response carrying one into a 500. Serializing as a
 * plain number keeps the API shape unchanged (`fileSizeBytes: number`) and is
 * exact up to Number.MAX_SAFE_INTEGER (~9 PB), far beyond any file.
 *
 * This only changes behaviour for values that would otherwise throw, so it is
 * safe to install globally. Imported FIRST in main.ts (and by specs that need it).
 */
declare global {
  interface BigInt {
    toJSON(): number;
  }
}

if (typeof (BigInt.prototype as { toJSON?: unknown }).toJSON !== 'function') {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function toJSON(this: bigint): number {
      return Number(this);
    },
    writable: true,
    configurable: true,
  });
}

export {};
