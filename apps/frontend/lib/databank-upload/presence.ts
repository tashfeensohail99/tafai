/**
 * Is there an upload queue in this tab, and is it busy? (Databank Phase 1, PR-7)
 *
 * Tiny and dependency-free ON PURPOSE: the root layout's dock host and every
 * shell's sign-out button import it, so users who never upload load nothing of
 * the engine. The queue registers itself here when it is first created.
 */

interface QueueLike {
  hasActive(): boolean;
}

let queue: QueueLike | null = null;
const listeners = new Set<() => void>();

export function registerQueue(q: QueueLike): void {
  queue = q;
  for (const fn of listeners) fn();
}

export function subscribePresence(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A queue exists in this tab (the dock should be mounted). */
export function isQueuePresent(): boolean {
  return queue !== null;
}

export function hasActiveUploads(): boolean {
  return !!queue?.hasActive();
}

export const STOP_UPLOADS_PROMPT =
  'Uploads are still running. If you sign out now they stop — saved files stay, and half-sent files continue if you drop them again within 6 days. Sign out?';

/** Before signing out: true when nothing is uploading, otherwise ask. */
export function confirmStopUploads(confirmFn?: (message: string) => boolean): boolean {
  if (!hasActiveUploads()) return true;
  const ask = confirmFn ?? (typeof globalThis.confirm === 'function' ? globalThis.confirm.bind(globalThis) : null);
  return ask ? ask(STOP_UPLOADS_PROMPT) : true;
}

/** Tests only. */
export function _resetPresenceForTests(): void {
  queue = null;
  listeners.clear();
}
