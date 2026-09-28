/**
 * Retry policy for the databank uploader: exponential backoff with jitter, and
 * how to treat each failure. A Pakistani office link drops, stalls and gets
 * throttled routinely, so "try again, later, and less at once" is the default;
 * only errors that can never succeed on retry stop a file.
 */

/** Backoff before retry `attempt` (1-based): 1 s, 2 s, 4 s … capped at 30 s,
 *  each scaled by a random 50–100 % so many parts don't retry in lock-step. */
export function backoffMs(attempt: number, random: () => number): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.5 + random() * 0.5));
}

export type PutFailure =
  /** The presigned URL expired or was refused — sign a fresh one and retry. */
  | 'resign'
  /** The upload session is gone from storage (aborted / auto-expired). */
  | 'session-gone'
  /** Network drop, stall, throttling or a storage hiccup — back off, retry. */
  | 'transient'
  /** Can never succeed as-is. */
  | 'fatal';

/** Classify a failed part PUT by HTTP status (0 = network error / no response). */
export function classifyPut(status: number): PutFailure {
  if (status === 403) return 'resign';
  if (status === 404) return 'session-gone';
  if (status === 0 || status === 408 || status === 429 || status >= 500) return 'transient';
  return 'fatal';
}

export type ApiFailure = 'transient' | 'fatal';

/** Classify a failed call to OUR API (init / parts / complete). */
export function classifyApi(status: number): ApiFailure {
  return status === 0 || status === 408 || status === 429 || status >= 500 ? 'transient' : 'fatal';
}
