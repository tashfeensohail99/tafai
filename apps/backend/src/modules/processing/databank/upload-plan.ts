/**
 * Pure part-planning + verification for resumable databank uploads
 * (Databank Phase 1 — docs/databank-phase1-resumable-uploads.md §3).
 *
 * The SERVER decides the plan once, stores it on the upload session, and resume
 * reuses it — so the browser never has to re-derive it. No I/O here: this is the
 * single source of truth for "how is an N-byte file split" and "did R2 receive
 * exactly that", and it is unit-tested in isolation.
 *
 * Cloudflare R2 multipart rules this respects: every part except the last must
 * be the SAME size, parts are 5 MiB–5 GiB, at most 10,000 parts per upload.
 */

export const MiB = 1024 * 1024;
export const GiB = 1024 * MiB;

/** Files up to this size go as ONE presigned PUT (cheaper, simpler; a small
 *  file restarting on a dropped connection costs little). */
export const SINGLE_PUT_MAX_BYTES = 32 * MiB;
/** Smallest part we use. R2's floor is 5 MiB; 8 MiB keeps a stalled part cheap
 *  to redo and progress fine-grained (~$0.003 more Class-A ops per 10 GB). */
export const MIN_PART_BYTES = 8 * MiB;
/** Target ceiling on part count — headroom under R2's hard 10,000. */
export const TARGET_MAX_PARTS = 9000;
/** R2 hard limits. */
export const R2_MAX_PARTS = 10_000;
export const R2_MAX_PART_BYTES = 5 * GiB;
export const R2_MIN_PART_BYTES = 5 * MiB;
/** Default per-file cap (env DATABANK_MAX_FILE_BYTES overrides). */
export const DEFAULT_MAX_UPLOAD_BYTES = 50 * GiB;

export type UploadPlan =
  | { strategy: 'SINGLE'; sizeBytes: number }
  | { strategy: 'MULTIPART'; sizeBytes: number; partSize: number; partCount: number };

const ceilToMiB = (n: number): number => Math.ceil(n / MiB) * MiB;

/**
 * Split a file of `sizeBytes` into an R2-valid plan.
 *  - ≤ 32 MiB → SINGLE (one presigned PUT; 0-byte files included).
 *  - else partSize = max(8 MiB, ceilToMiB(size / 9000)), partCount = ceil(size / partSize).
 *    10 GiB → 1,280 × 8 MiB; 100 GiB → 8,534 × 12 MiB.
 * Throws RangeError for a size that isn't a non-negative safe integer or that no
 * valid plan can hold. The per-file business cap is checked separately
 * ({@link exceedsUploadCap}) so callers can give a friendly message.
 */
export function planParts(sizeBytes: number): UploadPlan {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new RangeError(`Invalid file size: ${sizeBytes}`);
  }
  if (sizeBytes <= SINGLE_PUT_MAX_BYTES) return { strategy: 'SINGLE', sizeBytes };

  const partSize = Math.max(MIN_PART_BYTES, ceilToMiB(sizeBytes / TARGET_MAX_PARTS));
  const partCount = Math.ceil(sizeBytes / partSize);
  if (partSize > R2_MAX_PART_BYTES || partCount > R2_MAX_PARTS) {
    throw new RangeError(`File too large for a multipart upload: ${sizeBytes} bytes`);
  }
  return { strategy: 'MULTIPART', sizeBytes, partSize, partCount };
}

/** Bytes the given 1-based part must contain under `plan`. */
export function expectedPartBytes(
  plan: { sizeBytes: number; partSize: number; partCount: number },
  partNumber: number,
): number {
  if (partNumber < 1 || partNumber > plan.partCount) return 0;
  return partNumber < plan.partCount
    ? plan.partSize
    : plan.sizeBytes - (plan.partCount - 1) * plan.partSize;
}

/** True when a file is over the per-file upload cap. */
export function exceedsUploadCap(sizeBytes: number, maxBytes: number = DEFAULT_MAX_UPLOAD_BYTES): boolean {
  return sizeBytes > maxBytes;
}

/** Resolve the per-file cap from an env value (bytes), falling back to 50 GiB.
 *  Clamped to what a multipart plan can actually hold. */
export function resolveMaxUploadBytes(raw: string | undefined): number {
  const n = raw ? Number(raw) : NaN;
  const cap = Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_MAX_UPLOAD_BYTES;
  return Math.min(cap, R2_MAX_PARTS * R2_MAX_PART_BYTES);
}

/** A part as R2's ListParts reports it. ETag is kept EXACTLY as returned
 *  (quotes included) — R2 rejects CompleteMultipartUpload otherwise. */
export interface ListedPart {
  partNumber: number;
  etag: string;
  sizeBytes: number;
}

export type PartsVerdict =
  | {
      ok: true;
      /** Parts 1..N sorted, ready for CompleteMultipartUpload. */
      completeParts: { partNumber: number; etag: string }[];
      /** Part numbers > N that R2 holds — harmless (not sent on complete). */
      ignoredExtraParts: number[];
    }
  | {
      ok: false;
      /** Part numbers the client must (re)send: absent, or present with the
       *  wrong size. Sorted ascending. */
      missingParts: number[];
    };

/**
 * Decide whether R2 holds EXACTLY the planned object before we complete it.
 * A presigned PUT can't enforce size, so this is where size is enforced: every
 * part 1..N must be present with exactly its planned length. Parts above N
 * can't be produced by our signed URLs; if present they are ignored (not sent
 * on complete, which discards them). Duplicate listings of one part number
 * (shouldn't happen — a re-upload replaces) use the last one listed.
 */
export function verifyParts(
  plan: { sizeBytes: number; partSize: number; partCount: number },
  listed: ListedPart[],
): PartsVerdict {
  const byNumber = new Map<number, ListedPart>();
  const extras = new Set<number>();
  for (const p of listed) {
    if (!Number.isInteger(p.partNumber) || p.partNumber < 1) continue;
    if (p.partNumber > plan.partCount) extras.add(p.partNumber);
    else byNumber.set(p.partNumber, p);
  }

  const missingParts: number[] = [];
  for (let n = 1; n <= plan.partCount; n++) {
    const p = byNumber.get(n);
    if (!p || !p.etag || p.sizeBytes !== expectedPartBytes(plan, n)) missingParts.push(n);
  }
  if (missingParts.length) return { ok: false, missingParts };

  const completeParts = [...byNumber.values()]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => ({ partNumber: p.partNumber, etag: p.etag }));
  return { ok: true, completeParts, ignoredExtraParts: [...extras].sort((a, b) => a - b) };
}
