/**
 * Showing uploaded files in the explorer without refetching the whole tree
 * (Databank Phase 1, PR-7). Pure.
 *
 * A completed upload returns the recorded file row — the same shape the tree
 * lists — so the explorer merges it straight in. The tree is refetched only
 * when folders were created (a folder drop), debounced, and once when a batch
 * goes idle: a 2,000-file client is not reloaded per file from a DB in Seoul.
 */

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Upsert landed file rows (new ones first, like the tree's newest-first order);
 *  anything that doesn't look like a file row is ignored. */
export function mergeLandedFiles<T extends { id: string }>(files: T[], landed: unknown[]): T[] {
  const rows = landed.filter(
    (r): r is T =>
      !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' && typeof (r as { fileName?: unknown }).fileName === 'string',
  );
  if (!rows.length) return files;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const fresh = rows.filter((r, i) => rows.findIndex((x) => x.id === r.id) === i && !files.some((f) => f.id === r.id));
  const updated = files.map((f) => byId.get(f.id) ?? f);
  return [...fresh.reverse(), ...updated];
}

/** Coalesces "the tree changed" into at most one reload per `minIntervalMs`,
 *  each at least `debounceMs` after the request that triggered it. */
export function createLandingReloader(opts: {
  timers: Timers;
  now: () => number;
  reload: () => unknown;
  debounceMs?: number;
  minIntervalMs?: number;
}) {
  const debounceMs = opts.debounceMs ?? 1500;
  const minIntervalMs = opts.minIntervalMs ?? 5000;
  let handle: unknown = null;
  let lastReloadAt = -Infinity;
  let disposed = false;
  const fire = () => {
    handle = null;
    if (disposed) return;
    lastReloadAt = opts.now();
    void opts.reload();
  };
  return {
    /** Something changed: reload soon (debounced, rate-limited). */
    request(): void {
      if (disposed || handle !== null) return;
      const wait = Math.max(debounceMs, lastReloadAt + minIntervalMs - opts.now());
      handle = opts.timers.set(fire, wait);
    },
    /** Reload now (e.g. the batch finished). */
    flush(): void {
      if (disposed) return;
      if (handle !== null) opts.timers.clear(handle);
      fire();
    },
    dispose(): void {
      disposed = true;
      if (handle !== null) opts.timers.clear(handle);
      handle = null;
    },
  };
}
