/**
 * Browser lifecycle for the upload queue (Databank Phase 1, PR-7). The window,
 * navigator and document are INJECTED (EventTarget-like), so this is tested
 * with plain EventTargets.
 *
 *  - online / offline → queue.setOnline (seeded from navigator.onLine)
 *  - "Leave site?" (beforeunload) — only while something is uploading
 *  - Screen Wake Lock while uploading and visible (re-taken on return; the
 *    browser drops it when the tab is hidden) — a sleeping screen can suspend
 *    the network on some laptops
 *  - a drop guard while uploading: a file dropped OUTSIDE a drop zone would
 *    otherwise make the browser open it and navigate away mid-upload
 *  - 'tafsheen:logout' (dispatched by session.logout) → stop the queue
 * It never touches document.title (the notifications bell owns it).
 */

export interface LifecycleQueue {
  setOnline(online: boolean): void;
  hasActive(): boolean;
  subscribe(fn: () => void): () => void;
  shutdown(reason: 'logout' | 'user-changed'): void;
}

interface Target {
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

export interface NavigatorLike {
  onLine?: boolean;
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

export interface DocumentLike extends Target {
  visibilityState?: string;
}

export function attachLifecycle(q: LifecycleQueue, win: Target, nav: NavigatorLike, doc: DocumentLike): () => void {
  const onOnline = () => q.setOnline(true);
  const onOffline = () => q.setOnline(false);
  const onLogout = () => q.shutdown('logout');
  const onBeforeUnload = (e: Event) => {
    e.preventDefault();
    (e as unknown as { returnValue: string }).returnValue = ''; // BeforeUnloadEvent (older browsers need it)
  };
  const onStrayDrag = (e: Event) => {
    if (e.defaultPrevented) return; // a real drop zone handled it
    e.preventDefault();
    const dt = (e as Event & { dataTransfer?: { dropEffect: string } | null }).dataTransfer;
    if (dt) dt.dropEffect = 'none';
  };

  win.addEventListener('online', onOnline);
  win.addEventListener('offline', onOffline);
  win.addEventListener('tafsheen:logout', onLogout);
  if (nav.onLine === false) q.setOnline(false);

  let guarded = false;
  let lock: WakeLockSentinelLike | null = null;
  let wantLock = false;
  let requesting = false;
  let detached = false;

  const releaseLock = () => {
    const l = lock;
    lock = null;
    if (l) l.release().catch(() => undefined);
  };
  const takeLock = () => {
    if (lock || requesting || !nav.wakeLock || doc.visibilityState === 'hidden') return;
    requesting = true;
    try {
      nav.wakeLock
        .request('screen')
        .then((l) => {
          requesting = false;
          if (!wantLock || detached) l.release().catch(() => undefined);
          else lock = l;
        })
        .catch(() => {
          requesting = false; // not allowed (e.g. battery saver) — uploads go on without it
        });
    } catch {
      requesting = false;
    }
  };
  const onVisibility = () => {
    if (doc.visibilityState === 'visible' && wantLock) {
      lock = null; // the browser released it while hidden
      takeLock();
    }
  };
  doc.addEventListener('visibilitychange', onVisibility);

  const sync = () => {
    const active = q.hasActive();
    if (active && !guarded) {
      guarded = true;
      win.addEventListener('beforeunload', onBeforeUnload);
      win.addEventListener('dragover', onStrayDrag);
      win.addEventListener('drop', onStrayDrag);
    } else if (!active && guarded) {
      guarded = false;
      win.removeEventListener('beforeunload', onBeforeUnload);
      win.removeEventListener('dragover', onStrayDrag);
      win.removeEventListener('drop', onStrayDrag);
    }
    wantLock = active;
    if (active) takeLock();
    else releaseLock();
  };
  const unsubscribe = q.subscribe(sync);
  sync();

  return () => {
    detached = true;
    unsubscribe();
    win.removeEventListener('online', onOnline);
    win.removeEventListener('offline', onOffline);
    win.removeEventListener('tafsheen:logout', onLogout);
    doc.removeEventListener('visibilitychange', onVisibility);
    if (guarded) {
      win.removeEventListener('beforeunload', onBeforeUnload);
      win.removeEventListener('dragover', onStrayDrag);
      win.removeEventListener('drop', onStrayDrag);
    }
    wantLock = false;
    releaseLock();
  };
}
