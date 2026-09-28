/**
 * The upload queue behind the upload dock (Databank Phase 1, PR-7). Pure: no
 * DOM, no React — the browser glue injects the transport, the env and the
 * session hooks, and the dock reads getSnapshot().
 *
 * MODEL: one UploadEngine per BATCH (one drop), with admission control. The
 * engine hashes, inits and fills part slots strictly in job order, so a small
 * drop inside a 20 GB engine would wait hours. Instead:
 *   - "express" batches (≤ 256 MiB) always run, alongside everything;
 *   - ONE big batch runs at a time (sticky; oldest first, "Start now" reorders);
 *   - batches that aren't running are not even given to an engine (nothing is
 *     hashed early), or — once admitted — are paused.
 * The engine itself is unchanged (reviewed separately).
 *
 * SIGN-IN: any 401 pauses the whole queue (the engine parks instead of failing
 * files) and a 5 s poll refreshes the session; the SAME user's new token
 * resumes, a DIFFERENT user wipes the queue. Nothing fails because a token ran
 * out mid-migration.
 *
 * DEV / KILL SWITCH: when the server answers init with `proxy` (dev storage, or
 * DATABANK_RESUMABLE_UPLOADS=off), that portal's files go through the standard
 * upload one at a time instead (≤ 2 GB).
 */

import type { EngineEnv, EngineOptions, FileStatus, FileView, UploadItem, UploadSource, UploadTransport } from './engine.ts';
import { TransportError, UploadEngine } from './engine.ts';
import type { DatabankBasePath, UploadTarget } from './transport.ts';
import { summarize } from './summary.ts';
import type { UploadSummary } from './summary.ts';
import { SpeedMeter } from './speed.ts';
import { backoffMs, classifyApi } from './retry.ts';
import { dataScopeOf, itemKey, jwtSub, targetKey } from './keys.ts';
import { needsCheck } from './summary.ts';
import { chunkPaths, orderForUpload, planFolderDrop } from './folder-plan.ts';
import type { Skipped } from './folder-plan.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface QueueTarget {
  base: DatabankBasePath;
  target: UploadTarget;
}

export interface BatchMeta {
  /** "Ali Khan" (the client) or "My folders". */
  label: string;
  /** Link back to that databank. */
  href?: string;
  /** "Databank › Passport" — where the drop went. */
  parentLabel: string;
  parentFolderId: string | null;
}

export interface DropFile {
  file: UploadSource & { name: string; type: string; lastModified: number };
  /** Path inside a dropped folder ("Passport/scan.pdf"); absent for loose files. */
  relPath?: string;
}

export interface QueueDeps {
  makeTransport(t: QueueTarget): UploadTransport;
  env: EngineEnv;
  ensurePaths(
    t: QueueTarget,
    parentFolderId: string | null,
    paths: string[],
    signal: AbortSignal,
  ): Promise<{ folders: Record<string, string>; created: number }>;
  /** The standard (≤ 2 GB) upload, for files the server answered 'proxy' for.
   *  `signal` aborts it (Cancel, a stall, sign-out). */
  legacyUpload(
    t: QueueTarget,
    file: UploadSource,
    folderId: string | null,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
    opts: {
      /** The file is already in storage under this key: only record it (the
       *  server returns the row it already made if the first reply was lost). */
      commitKey?: string;
      /** Called once the bytes are stored, with their key. */
      onStored: (storageKey: string) => void;
    },
  ): Promise<unknown>;
  accessToken(): string | null;
  /** Try to get a fresh session (refresh the token). Never throws. */
  restoreSession(): Promise<void>;
  engineOptions?: EngineOptions;
}

export type RowView = FileView & { rowId: string; batchId: string; folderId: string | null; legacy?: true };

export type BatchState = 'preparing' | 'prepare-failed' | 'waiting-turn' | 'running' | 'paused' | 'needs-you' | 'finished';

export interface BatchView {
  id: string;
  label: string;
  href?: string;
  parentLabel: string;
  kind: 'files' | 'folder';
  rootNames: string[];
  dataScope: string;
  state: BatchState;
  prepareError?: string;
  rows: RowView[];
  skipped: Skipped[];
  /** Files in this drop that were already in the queue (not added twice). */
  alreadyListed: number;
  foldersCreated?: number;
  summary: UploadSummary;
  createdAt: number;
}

export interface QueueSnapshot {
  rev: number;
  batches: BatchView[];
  summary: UploadSummary;
  paused: boolean;
  offline: boolean;
  linkDown: boolean;
  authLost: boolean;
  /** Some portal is using the standard upload (dev storage / kill switch). */
  compat: boolean;
  active: boolean;
  bytesPerSecond: number;
  etaSeconds: number | null;
  /** Rows / batches that need the officer: failed, duplicate choices, folder errors. */
  attention: number;
  runningLabel?: string;
  /** Files can't be read and nothing shows the drive works: "Is the drive connected?". */
  readsWaiting: boolean;
  /** Uploads were stopped for a reason the officer must hear about (kept until dismissed). */
  notice?: QueueNotice;
}

export interface QueueNotice {
  reason: 'user-changed';
  /** Per stopped drop: files that were NOT uploaded — whose, and where to. An
   *  entry ends when that officer drops into that place again, or on OK. */
  lost: Array<{ label: string; count: number; ownerSub?: string; tKey?: string }>;
}

export interface LandedEvent {
  /** Recorded file rows (the tree's shape) that just landed in this databank. */
  files: unknown[];
  /** Folders were created (a folder drop) — refetch the tree. */
  foldersChanged: boolean;
  /** The last busy batch for this databank just finished. */
  idle: boolean;
}

const EMPTY_SUMMARY: UploadSummary = summarize([]);

export const EMPTY_SNAPSHOT: QueueSnapshot = Object.freeze({
  rev: 0,
  batches: [],
  summary: EMPTY_SUMMARY,
  paused: false,
  offline: false,
  linkDown: false,
  authLost: false,
  compat: false,
  active: false,
  bytesPerSecond: 0,
  etaSeconds: null,
  attention: 0,
  readsWaiting: false,
}) as QueueSnapshot;

/** Drops up to this size always run at once, even beside a big migration. */
export const EXPRESS_BYTES = 256 * 1024 * 1024;
/** The standard upload's per-file ceiling (the server's int4-era cap). */
export const LEGACY_MAX_BYTES = 2_147_483_647;

const FLUSH_MS = 250;
const AUTH_POLL_MS = 5_000;
const ENSURE_TIMEOUT_MS = 60_000;
const ENSURE_ATTEMPTS = 8;
const CANCEL_POOL = 4;
const PING_TIMEOUT_MS = 20_000;
/** A standard upload with no progress for this long is aborted and retried. */
const LEGACY_STALL_MS = 60_000;
/** Standard-upload failures while the link demonstrably works, before a file fails. */
const LEGACY_ATTEMPTS = 3;

const WORK: ReadonlySet<FileStatus> = new Set(['queued', 'hashing', 'hashed', 'ready', 'uploading', 'completing', 'cancelling']);
const LIVE: ReadonlySet<FileStatus> = new Set([...WORK, 'needs-decision']);

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface Batch {
  id: string;
  seq: number;
  target: QueueTarget;
  tKey: string;
  dataScope: string;
  meta: BatchMeta;
  kind: 'files' | 'folder';
  rootNames: string[];
  phase: 'preparing' | 'prepare-failed' | 'ready';
  prepareError?: string;
  prepareInput?: { files: DropFile[]; emptyDirs?: string[] };
  /** Items routed here but not yet handed to the engine. */
  pending: UploadItem[];
  engine?: UploadEngine;
  unsub?: () => void;
  rowIds: string[];
  skipped: Skipped[];
  alreadyListed: number;
  foldersCreated?: number;
  prioritizedAt?: number;
  createdAt: number;
  ctrl: AbortController;
  totalBytes: number;
  /** Rows of this batch on the standard upload (so hasWork never scans every row). */
  legacyIds: Set<string>;
  /** Folder preparation is waiting out a link outage (the dock says so). */
  linkWait?: boolean;
}

interface Row {
  batchId: string;
  key: string;
  item: UploadItem;
}

interface LegacyRow {
  status: 'waiting' | 'uploading' | 'done' | 'failed' | 'cancelled';
  bytesDone: number;
  error?: string;
  file?: unknown;
  /** Aborts the upload in flight. */
  ctrl?: AbortController;
  /** Failures while the link worked (see LEGACY_ATTEMPTS). */
  tries?: number;
  /** The bytes are in storage under this key: a retry only records them. */
  storedKey?: string;
  /** Cancel came after the bytes were stored: it is being recorded anyway. */
  lateCancel?: boolean;
  /** Inside the upload / save call right now (only then can't Cancel stop it). */
  inCall?: boolean;
  note?: string;
}

function statusOf(e: unknown): number {
  if (e instanceof TransportError) return e.status;
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : 0;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class UploadQueue {
  private readonly deps: QueueDeps;
  private readonly batches = new Map<string, Batch>();
  private readonly rows = new Map<string, Row>();
  /** `${targetKey}\u0001${itemKey}` → the row that owns that file. */
  private readonly owner = new Map<string, string>();
  private readonly legacy = new Map<string, LegacyRow>();
  /** Standard-upload rows waiting, per drop — picked by the same admission
   *  rules as the engines (express drops first, then the running big one). */
  private readonly legacyLanes = new Map<string, string[]>();
  private notice?: QueueNotice;
  private legacyRunning = false;
  private readonly transports = new Map<string, UploadTransport>();
  private readonly pauseReasons = new Set<'user' | 'auth'>();
  private offline = false;
  private authLost: { tokenAtLoss: string | null } | null = null;
  private authWaiters: Array<() => void> = [];
  private onlineWaiters: Array<() => void> = [];
  private readonly proxyBases = new Set<DatabankBasePath>();
  private readonly maxBytesByBase = new Map<DatabankBasePath, number>();
  private runningBig: string | null = null;
  private wireBytes = 0;
  private readonly speed = new SpeedMeter();
  private activeSince: number | null = null;
  private readonly lastStatus = new Map<string, FileStatus>();
  private readonly scopeBusy = new Map<string, boolean>();
  private readonly landedListeners = new Map<string, Set<(e: LandedEvent) => void>>();
  private readonly pendingLanded = new Map<string, { files: unknown[]; foldersChanged: boolean }>();
  private ownerId: string | null = null;
  private shut = false;
  /** Bumped by shutdown(): engines from before it can never reach the server again. */
  private gen = 0;
  private seq = 0;
  private snapshot: QueueSnapshot = EMPTY_SNAPSHOT;
  private readonly subscribers = new Set<() => void>();
  private flushScheduled = false;
  private lastFlushAt = -Infinity;
  private flushTimer: AbortController | null = null;
  /** hasWork() answers, memoised for one synchronous pass (flush, reconcile, a drop). */
  private workMemo: Map<Batch, boolean> | null = null;

  constructor(deps: QueueDeps) {
    this.deps = deps;
  }

  // ---- enqueue ----------------------------------------------------------------

  /** Loose files dropped into `meta.parentFolderId`. Returns the batch id. */
  enqueueFiles(t: QueueTarget, meta: BatchMeta, files: DropFile[], skipped: Skipped[] = []): string {
    this.checkOwner(t);
    const b = this.newBatch(t, meta, 'files');
    b.skipped.push(...skipped);
    const ordered = orderForUpload(files.map((f) => ({ f, size: f.file.size, path: f.relPath || f.file.name })));
    this.withMemo(() => {
      for (const { f } of ordered) this.route(b, meta.parentFolderId, f);
    });
    b.phase = 'ready';
    this.afterChange();
    return b.id;
  }

  /** A dropped folder tree: creates the folders (one ensure-paths call per
   *  ≤ 1,000 paths), then queues every file into its own folder. */
  enqueueFolder(t: QueueTarget, meta: BatchMeta, files: DropFile[], opts: { emptyDirs?: string[] } = {}): string {
    this.checkOwner(t);
    const b = this.newBatch(t, meta, 'folder');
    b.prepareInput = { files, emptyDirs: opts.emptyDirs };
    b.phase = 'preparing';
    this.markDirty();
    void this.prepare(b);
    return b.id;
  }

  /** "Try again" after the folders could not be created. */
  retryPrepare(batchId: string): void {
    const b = this.batches.get(batchId);
    if (!b || b.phase !== 'prepare-failed') return;
    b.phase = 'preparing';
    b.prepareError = undefined;
    b.ctrl = new AbortController();
    this.markDirty();
    void this.prepare(b);
  }

  // ---- actions -----------------------------------------------------------------

  /** "Start now": this big batch goes before the one running. */
  prioritize(batchId: string): void {
    const b = this.batches.get(batchId);
    if (!b) return;
    b.prioritizedAt = this.deps.env.now();
    if (!this.isExpress(b)) this.runningBig = b.id;
    this.afterChange();
  }

  pauseAll(): void {
    this.pauseReasons.add('user');
    for (const b of this.batches.values()) b.engine?.pause();
    this.afterChange();
  }

  resumeAll(): void {
    this.pauseReasons.delete('user');
    this.afterChange();
  }

  setOnline(online: boolean): void {
    this.offline = !online;
    for (const b of this.batches.values()) b.engine?.setOnline(online);
    if (online) this.wake('online');
    this.markDirty();
  }

  /** "Continue" after being signed out. */
  async checkAuth(): Promise<void> {
    await this.pollAuth();
  }

  async cancel(rowId: string): Promise<void> {
    const r = this.rows.get(rowId);
    const b = r && this.batches.get(r.batchId);
    if (!r || !b) return;
    const lg = this.legacy.get(rowId);
    if (lg) {
      if (lg.status === 'waiting' || lg.status === 'uploading') {
        this.cancelLegacy(lg);
        this.afterChange();
      }
      return;
    }
    const i = b.pending.findIndex((it) => it.key === r.key);
    if (i >= 0) {
      b.pending.splice(i, 1);
      this.legacy.set(rowId, { status: 'cancelled', bytesDone: 0 }); // shown as a cancelled row
      this.afterChange();
      return;
    }
    if (b.engine?.status(r.key) === 'fallback') {
      // Answered 'proxy', not yet on the standard upload: it never goes there.
      this.legacy.set(rowId, { status: 'cancelled', bytesDone: 0 });
      b.legacyIds.add(rowId);
      this.afterChange();
      return;
    }
    await b.engine?.cancel(r.key);
    this.afterChange();
  }

  /** "Skip all" / "Upload all anyway" for a drop's duplicate choices. */
  resolveAllDuplicates(batchId: string, choice: 'skip' | 'upload'): void {
    const b = this.batches.get(batchId);
    if (!b?.engine) return;
    for (const f of b.engine.snapshot().files) if (f.status === 'needs-decision') b.engine.resolveDuplicate(f.key, choice);
    this.revive(b);
    this.afterChange();
  }

  /** The "someone else signed in" notice, once read. */
  dismissNotice(): void {
    if (!this.notice) return;
    this.notice = undefined;
    this.snapshot = Object.freeze({ ...this.snapshot, rev: this.snapshot.rev + 1, notice: undefined });
    for (const fn of this.subscribers) fn();
  }

  /** Remove a failed row. If another live row (a re-dropped copy) is using its
   *  server session, only this row goes — the copy's upload is untouched. */
  async discard(rowId: string): Promise<void> {
    const r = this.rows.get(rowId);
    const b = r && this.batches.get(r.batchId);
    const lg = this.legacy.get(rowId);
    if (r && b && lg) {
      if (lg.status === 'failed') {
        lg.status = 'cancelled';
        this.afterChange();
      }
      return;
    }
    if (!r || !b?.engine) return;
    const view = b.engine.file(r.key);
    if (!view || view.status !== 'failed') return;
    const shared = !!view.uploadId && this.liveUploadIdsExcept(b).has(view.uploadId);
    await b.engine.cancel(r.key, { keepSession: shared });
    this.afterChange();
  }

  async cancelBatch(batchId: string): Promise<void> {
    const b = this.batches.get(batchId);
    if (!b) return;
    b.ctrl.abort();
    for (const rowId of b.legacyIds) {
      const lg = this.legacy.get(rowId);
      if (lg?.status === 'waiting' || lg?.status === 'uploading') this.cancelLegacy(lg);
    }
    const pendingKeys = new Set(b.pending.map((it) => it.key));
    b.pending = [];
    for (const rowId of b.rowIds) {
      const r = this.rows.get(rowId);
      if (r && pendingKeys.has(r.key)) this.legacy.set(rowId, { status: 'cancelled', bytesDone: 0 });
    }
    if (b.phase !== 'ready') {
      b.phase = 'ready';
      b.prepareError = undefined;
    }
    const engine = b.engine;
    if (engine) {
      const elsewhere = this.liveUploadIdsExcept(b);
      const files = engine.snapshot().files;
      for (const f of files) {
        const id = `${b.id}\u0001${f.key}`;
        if (f.status === 'fallback' && this.rows.has(id) && !this.legacy.has(id)) {
          this.legacy.set(id, { status: 'cancelled', bytesDone: 0 }); // answered 'proxy', never goes standard now
          b.legacyIds.add(id);
        }
      }
      const todo = files
        .filter((f) => WORK.has(f.status) || f.status === 'needs-decision' || f.status === 'failed')
        .map((f) => ({ key: f.key, keepSession: f.status === 'failed' && !!f.uploadId && elsewhere.has(f.uploadId) }));
      // A pool of 4 at a time — not 1,800 DELETEs at once.
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const t = todo[next++];
          await engine.cancel(t.key, { keepSession: t.keepSession });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CANCEL_POOL, todo.length) }, worker));
    }
    this.afterChange();
  }

  async cancelAll(): Promise<void> {
    await Promise.all([...this.batches.keys()].map((id) => this.cancelBatch(id)));
  }

  retry(rowId: string): void {
    if (this.retryRow(rowId)) this.afterChange();
  }

  retryFailed(batchId?: string): void {
    for (const b of this.batches.values()) {
      if (batchId && b.id !== batchId) continue;
      b.engine?.retryFailed();
      for (const rowId of [...b.legacyIds]) if (this.legacy.get(rowId)?.status === 'failed') this.retryRow(rowId);
      this.revive(b);
    }
    this.afterChange();
  }

  /** Retry one row without the reconcile (retryFailed does one at the end). A
   *  standard-upload row asks the SERVER again: only a fresh 'proxy' answer
   *  sends it back to the standard upload (the switch may be off by now, or its
   *  earlier session may be finishing — then init says so). */
  private retryRow(rowId: string): boolean {
    const r = this.rows.get(rowId);
    const b = r && this.batches.get(r.batchId);
    if (!r || !b) return false;
    this.revive(b);
    const lg = this.legacy.get(rowId);
    if (lg) {
      if (lg.status !== 'failed' && lg.status !== 'cancelled') return false;
      this.forgetLegacy(b, rowId);
      if (b.engine?.status(r.key)) b.engine.add([r.item]); // (a fallback / cancelled engine file is re-inited)
      else b.pending.push(r.item);
      return true;
    }
    b.engine?.retry(r.key);
    return true;
  }

  resolveDuplicate(rowId: string, choice: 'skip' | 'upload'): void {
    const r = this.rows.get(rowId);
    const b = r && this.batches.get(r.batchId);
    if (!r || !b?.engine) return;
    b.engine.resolveDuplicate(r.key, choice);
    this.afterChange();
  }

  /** Remove a batch from the dock — not while anything is still running. Files
   *  that failed or wait on a choice are given up HERE only: no DELETE burst,
   *  and never a session another copy uses. Their server sessions expire on
   *  their own — or continue if the same files are dropped again within 6 days.
   *  The dock asks the officer first when anything was not uploaded. */
  dismissBatch(batchId: string): void {
    const b = this.batches.get(batchId);
    if (!b || b.phase === 'preparing' || this.hasWork(b)) return;
    const engine = b.engine;
    if (engine) {
      for (const f of engine.snapshot().files) {
        if (f.status === 'failed' || f.status === 'needs-decision') void engine.cancel(f.key, { keepSession: true });
      }
    }
    this.legacyLanes.delete(batchId);
    b.unsub?.();
    for (const rowId of b.rowIds) {
      const r = this.rows.get(rowId);
      if (r) {
        const ok = `${b.tKey}\u0001${r.key}`;
        if (this.owner.get(ok) === rowId) this.owner.delete(ok);
      }
      this.rows.delete(rowId);
      this.legacy.delete(rowId);
      this.lastStatus.delete(rowId);
    }
    this.batches.delete(batchId);
    if (this.runningBig === batchId) this.runningBig = null;
    this.afterChange();
  }

  /** Remove batches that finished CLEANLY (nothing failed, skipped or undecided). */
  clearFinished(): void {
    for (const b of [...this.batches.values()]) if (this.isClean(b)) this.dismissBatch(b.id);
  }

  /** Sign-out / another user: stop everything, locally. No DELETE is sent —
   *  the server keeps the sessions for 6 days, so dropping the same files again
   *  (after signing back in) continues where they stopped. */
  shutdown(reason: 'logout' | 'user-changed'): void {
    // Another officer signed in on this browser: the dock must SAY the uploads
    // stopped, and what was left — not just vanish as if everything finished.
    if (reason === 'user-changed') {
      const lost: QueueNotice['lost'] = [];
      for (const b of this.batches.values()) {
        let count = b.skipped.length + (b.phase === 'ready' ? 0 : (b.prepareInput?.files.length ?? 0));
        for (const rowId of b.rowIds) {
          const st = this.rowStatus(rowId);
          if (st !== 'done' && st !== 'skipped' && st !== 'handed-off') count += 1;
        }
        if (count) lost.push({ label: b.meta.label, count, ownerSub: this.ownerId ?? undefined, tKey: b.tKey });
      }
      // Added to, never replaced: an earlier officer's stopped drops nobody has
      // read yet stay listed (a newer count for the same officer + place wins).
      const same = (a: QueueNotice['lost'][number], c: QueueNotice['lost'][number]) => a.ownerSub === c.ownerSub && a.tKey === c.tKey;
      const kept = (this.notice?.lost ?? []).filter((old) => !lost.some((l) => same(old, l)));
      const all = [...kept, ...lost];
      this.notice = all.length ? { reason, lost: all } : undefined;
    }
    this.shut = true;
    this.gen += 1;
    for (const b of this.batches.values()) {
      b.ctrl.abort();
      const engine = b.engine;
      if (engine) {
        engine.pause();
        for (const f of engine.snapshot().files) {
          if ((f.status === 'queued' || f.status === 'hashing' || f.status === 'hashed') && !f.uploadId) void engine.cancel(f.key);
        }
      }
      b.unsub?.();
    }
    for (const lg of this.legacy.values()) lg.ctrl?.abort();
    this.batches.clear();
    this.rows.clear();
    this.owner.clear();
    this.legacy.clear();
    this.proxyBases.clear();
    this.legacyLanes.clear();
    this.lastStatus.clear();
    this.scopeBusy.clear();
    this.pendingLanded.clear();
    this.transports.clear();
    this.pauseReasons.clear();
    this.authLost = null;
    this.runningBig = null;
    this.ownerId = null;
    this.wake('auth');
    this.wake('online');
    this.snapshot = { ...EMPTY_SNAPSHOT, rev: this.snapshot.rev + 1, notice: this.notice };
    for (const fn of this.subscribers) fn();
    this.shut = false; // the queue can be used again (by whoever signs in next)
  }

  // ---- reading -----------------------------------------------------------------

  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  getSnapshot(): QueueSnapshot {
    return this.snapshot;
  }

  /** Files landing in one databank (`c:<clientId>` or `me`) — for the explorer. */
  onLanded(dataScope: string, fn: (e: LandedEvent) => void): () => void {
    let set = this.landedListeners.get(dataScope);
    if (!set) this.landedListeners.set(dataScope, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  hasActive(): boolean {
    if (this.snapshot.active) return true;
    for (const b of this.batches.values()) if (b.phase === 'preparing' || this.hasWork(b)) return true;
    return false;
  }

  /** The server's per-file limit for a portal, once an init has told us. */
  maxBytes(base: DatabankBasePath): number | undefined {
    return this.maxBytesByBase.get(base);
  }

  /** Server session ids still in use by a row that isn't finished. */
  liveUploadIds(): Set<string> {
    const ids = new Set<string>();
    for (const b of this.batches.values()) {
      for (const f of b.engine?.snapshot().files ?? []) if (f.uploadId && !['done', 'cancelled', 'skipped', 'fallback'].includes(f.status)) ids.add(f.uploadId);
    }
    return ids;
  }

  // ---- internals: batches, routing ---------------------------------------------------

  private checkOwner(t: QueueTarget): void {
    if (t.target.userId) throw new Error('Uploading into another associate’s folders is not available here yet.');
    const sub = jwtSub(this.deps.accessToken());
    if (!sub) throw new Error('Sign in again to upload.');
    if (this.ownerId && sub !== this.ownerId) this.shutdown('user-changed');
    // The officer whose uploads stopped is back and drops into THAT place again:
    // that line ("N files for X were not uploaded") has done its job and would
    // soon be untrue. Lines for other places — or other officers — stay.
    if (this.notice) {
      const tKey = targetKey(t.base, t.target);
      const left = this.notice.lost.filter((l) => !(l.ownerSub === sub && l.tKey === tKey));
      if (left.length !== this.notice.lost.length) this.notice = left.length ? { ...this.notice, lost: left } : undefined;
    }
    this.ownerId = sub;
  }

  /** Is this tab still signed in as the officer who queued the uploads? The
   *  access token can change under us with no 401 (apiFetch refreshes with the
   *  refresh token another person's sign-in left in shared storage): another
   *  user ⇒ stop everything (never upload one officer's files as another). */
  private sameUser(): boolean {
    const sub = jwtSub(this.deps.accessToken());
    if (sub && this.ownerId && sub !== this.ownerId) {
      this.shutdown('user-changed');
      return false;
    }
    return true;
  }

  private newBatch(t: QueueTarget, meta: BatchMeta, kind: 'files' | 'folder'): Batch {
    const seq = ++this.seq;
    const b: Batch = {
      id: `b${seq}`,
      seq,
      target: t,
      tKey: targetKey(t.base, t.target),
      dataScope: dataScopeOf(t.target),
      meta,
      kind,
      rootNames: [],
      phase: 'preparing',
      pending: [],
      rowIds: [],
      skipped: [],
      alreadyListed: 0,
      createdAt: this.deps.env.now(),
      ctrl: new AbortController(),
      totalBytes: 0,
      legacyIds: new Set(),
    };
    this.batches.set(b.id, b);
    return b;
  }

  /** Put one dropped file into the queue — or route it to the row that already
   *  owns it (same destination, path, size, lastModified). */
  private route(b: Batch, folderId: string | null, f: DropFile): void {
    const relOrName = f.relPath || f.file.name;
    const key = itemKey(folderId, relOrName, f.file.size, f.file.lastModified);
    const item: UploadItem = {
      key,
      source: f.file,
      fileName: f.file.name,
      mimeType: f.file.type,
      relativePath: f.relPath,
      folderId,
      lastModified: f.file.lastModified,
    };
    const ownerKey = `${b.tKey}\u0001${key}`;
    const existingId = this.owner.get(ownerKey);
    const existing = existingId ? this.rows.get(existingId) : undefined;
    const ob = existing ? this.batches.get(existing.batchId) : undefined;
    if (existing && ob) {
      const st = this.rowStatus(existingId!);
      if (LIVE.has(st) || st === 'queued') {
        b.alreadyListed += 1;
        return;
      }
      const reusable = st === 'failed' || st === 'cancelled' || this.hasWork(ob);
      if (reusable) {
        // Hand the new File to the row that owns this upload (keeps the
        // engine's session hand-over protection within one engine).
        existing.item = item;
        this.revive(ob);
        const lg = this.legacy.get(existingId!);
        if (lg) {
          // Ask the server again — never straight to the standard upload.
          this.forgetLegacy(ob, existingId!);
          if (ob.engine?.status(key)) ob.engine.add([item]);
          else ob.pending.push(item);
        } else if (ob.engine) {
          ob.engine.add([item]);
        } else {
          const i = ob.pending.findIndex((it) => it.key === key);
          if (i >= 0) ob.pending[i] = item;
          else ob.pending.push(item);
        }
        this.workMemo?.set(ob, true);
        b.alreadyListed += 1;
        return;
      }
    }
    const rowId = `${b.id}\u0001${key}`;
    this.rows.set(rowId, { batchId: b.id, key, item });
    this.owner.set(ownerKey, rowId);
    b.rowIds.push(rowId);
    b.totalBytes += f.file.size;
    // Always the server first: init answers per file (a session already
    // finishing, a duplicate, or 'proxy' → only then the standard upload).
    b.pending.push(item);
  }

  /** A row's status as of the last snapshot (≤ 250 ms old) — O(1), so a
   *  2,000-file re-drop doesn't copy the engine's views 2,000 times. */
  private rowStatus(rowId: string): FileStatus {
    const lg = this.legacy.get(rowId);
    if (lg) return lg.status === 'waiting' ? 'queued' : lg.status;
    const st = this.lastStatus.get(rowId);
    return !st || st === 'fallback' ? 'queued' : st;
  }

  private isExpress(b: Batch): boolean {
    return b.totalBytes <= EXPRESS_BYTES;
  }

  private hasWork(b: Batch): boolean {
    if (b.phase !== 'ready') return b.phase === 'preparing';
    if (b.pending.length) return true;
    const memo = this.workMemo?.get(b);
    if (memo !== undefined) return memo;
    let work = false;
    for (const rowId of b.legacyIds) {
      const s = this.legacy.get(rowId)?.status;
      if (s === 'waiting' || s === 'uploading') {
        work = true;
        break;
      }
    }
    if (!work && b.engine) work = b.engine.hasWork();
    this.workMemo?.set(b, work);
    return work;
  }

  /** Run `fn` with hasWork() memoised (one answer per batch for the pass). */
  private withMemo<T>(fn: () => T): T {
    if (this.workMemo) return fn();
    this.workMemo = new Map();
    try {
      return fn();
    } finally {
      this.workMemo = null;
    }
  }

  /** Finished with nothing failed, undecided or left out. */
  private isClean(b: Batch): boolean {
    if (b.phase !== 'ready' || this.hasWork(b) || b.skipped.length) return false;
    for (const id of b.legacyIds) {
      const lg = this.legacy.get(id);
      if (lg && (lg.status === 'failed' || needsCheck(lg))) return false;
    }
    for (const f of b.engine?.snapshot().files ?? []) {
      if (f.status === 'needs-decision' || f.status === 'failed' || needsCheck(f)) return false;
    }
    return true;
  }

  /** A batch that was cancelled gets work again: a fresh signal, so its waits
   *  back off normally (an aborted one would end every nap at once). */
  private revive(b: Batch): void {
    if (b.ctrl.signal.aborted) b.ctrl = new AbortController();
  }

  /** Server sessions a LIVE row in ANOTHER batch is using (a re-dropped copy). */
  private liveUploadIdsExcept(b: Batch): Set<string> {
    const ids = new Set<string>();
    for (const o of this.batches.values()) {
      if (o === b || !o.engine) continue;
      for (const f of o.engine.snapshot().files) if (f.uploadId && LIVE.has(f.status)) ids.add(f.uploadId);
    }
    return ids;
  }

  private pushLegacy(batchId: string, rowId: string, front = false): void {
    let lane = this.legacyLanes.get(batchId);
    if (!lane) this.legacyLanes.set(batchId, (lane = []));
    if (front) lane.unshift(rowId);
    else lane.push(rowId);
  }

  /** The next standard-upload row, by the engines' admission rules: express
   *  drops first (oldest first), then the running big drop; others wait. */
  private pickLegacy(): string | undefined {
    let best: Batch | undefined;
    for (const b of this.batches.values()) {
      if (!this.legacyLanes.get(b.id)?.length) continue;
      const express = this.isExpress(b);
      if (!express && b.id !== this.runningBig) continue;
      if (!best || (express && !this.isExpress(best)) || (express === this.isExpress(best) && b.seq < best.seq)) best = b;
    }
    return best ? this.legacyLanes.get(best.id)!.shift() : undefined;
  }

  /** Stop a standard upload — unless it is being recorded right now (bytes
   *  stored, save in flight): Cancel can't undo that; it finishes and says so.
   *  Waiting to retry a save that failed: cancelled — but it may have been
   *  recorded already (a lost reply), so the row says to check the folder. */
  private cancelLegacy(lg: LegacyRow): void {
    if (lg.storedKey && lg.inCall) {
      lg.lateCancel = true;
      return;
    }
    if (lg.storedKey) lg.note = 'It may already have been saved — check the folder and delete it if unwanted.';
    lg.status = 'cancelled';
    lg.ctrl?.abort();
  }

  private forgetLegacy(b: Batch, rowId: string): void {
    this.legacy.get(rowId)?.ctrl?.abort();
    this.legacy.delete(rowId);
    b.legacyIds.delete(rowId);
  }

  /** Who may run: every express batch with work + ONE big batch (sticky). */
  private reconcile(): void {
    this.withMemo(() => this.reconcileNow());
  }

  private reconcileNow(): void {
    const ready = [...this.batches.values()].filter((b) => b.phase === 'ready');
    const big = this.runningBig ? this.batches.get(this.runningBig) : undefined;
    if (!big || !this.hasWork(big) || this.isExpress(big)) {
      const candidates = ready
        .filter((b) => !this.isExpress(b) && this.hasWork(b))
        .sort((a, b) => (b.prioritizedAt ?? -1) - (a.prioritizedAt ?? -1) || a.seq - b.seq);
      this.runningBig = candidates[0]?.id ?? null;
    }
    for (const b of ready) {
      const work = this.hasWork(b);
      const running = work && (this.isExpress(b) || b.id === this.runningBig);
      if (running && !b.engine) this.admit(b);
      if (!b.engine) continue;
      if (b.pending.length) {
        const items = b.pending;
        b.pending = [];
        b.engine.add(items);
      }
      if (running && this.pauseReasons.size === 0) b.engine.resume();
      else if (work) b.engine.pause();
    }
  }

  private admit(b: Batch): void {
    const engine = new UploadEngine(this.transportFor(b.target), this.deps.env, this.deps.engineOptions);
    b.engine = engine;
    b.unsub = engine.subscribe(() => this.markDirty());
    engine.setOnline(!this.offline);
    if (this.pauseReasons.size) engine.pause();
  }

  /** One transport per portal + databank, shared by its batches: guards 401s
   *  (pause, don't fail), learns proxy mode + the size cap from init, counts
   *  wire bytes for the speed meter. */
  private transportFor(t: QueueTarget): UploadTransport {
    const tKey = targetKey(t.base, t.target);
    const cached = this.transports.get(tKey);
    if (cached) return cached;
    const inner = this.deps.makeTransport(t);
    const gen = this.gen;
    const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
      if (this.shut || gen !== this.gen || !this.sameUser()) throw new TransportError('Stopped', 499);
      try {
        const res = await fn();
        // The call may have refreshed the token — as whom? Another user ⇒ stop.
        if (gen !== this.gen || !this.sameUser()) throw new TransportError('Stopped', 499);
        return res;
      } catch (e) {
        if (statusOf(e) === 401) {
          this.onAuthLost(); // pauses every engine first…
          throw new TransportError('Signed out', 0); // …so the engine parks this instead of failing it
        }
        throw e;
      }
    };
    const wrapped: UploadTransport = {
      init: (files, signal) =>
        guard(async () => {
          const res = await inner.init(files, signal);
          if (res && res.mode === 'direct' && typeof res.maxBytes === 'number') this.maxBytesByBase.set(t.base, res.maxBytes);
          if (res && res.mode === 'direct') this.proxyBases.delete(t.base); // the kill switch is off again
          if (res && res.mode === 'proxy') this.proxyBases.add(t.base);
          return res;
        }),
      signParts: (id, parts, signal) => guard(() => inner.signParts(id, parts, signal)),
      complete: (ids, signal) => guard(() => inner.complete(ids, signal)),
      abort: (id, signal) => guard(() => inner.abort(id, signal)),
      ping: inner.ping ? (signal) => guard(() => inner.ping!(signal)) : undefined,
      put: (part, body, onProgress, signal) => {
        if (gen !== this.gen) return Promise.reject(new TransportError('Stopped', 499));
        let last = 0;
        return inner.put(
          part,
          body,
          (loaded) => {
            this.wireBytes += Math.max(0, loaded - last);
            last = loaded;
            onProgress(loaded);
          },
          signal,
        );
      },
    };
    this.transports.set(tKey, wrapped);
    return wrapped;
  }

  // ---- internals: folder prepare -------------------------------------------------------

  private async prepare(b: Batch): Promise<void> {
    const input = b.prepareInput!;
    const plan = planFolderDrop(
      input.files.map((f) => ({ name: f.file.name, size: f.file.size, relPath: f.relPath ?? f.file.name, f })),
      { emptyDirs: input.emptyDirs },
    );
    b.skipped = [...plan.skipped];
    b.rootNames = plan.roots;
    const ctrl = b.ctrl;
    const folders = new Map<string, string>(); // a Map: "__proto__" is a legal folder name
    let created = 0;
    for (const chunk of chunkPaths(plan.dirPaths)) {
      let attempt = 0;
      let waits = 0;
      for (;;) {
        if (ctrl.signal.aborted || !this.sameUser()) return;
        try {
          const res = await this.ensureWithTimeout(b.target, b.meta.parentFolderId, chunk, ctrl.signal);
          if (!this.sameUser()) return;
          if (b.linkWait) {
            b.linkWait = false;
            this.markDirty();
          }
          for (const p of chunk) {
            const id = res && res.folders && Object.prototype.hasOwnProperty.call(res.folders, p) ? res.folders[p] : undefined;
            if (typeof id === 'string') folders.set(p, id);
          }
          created += typeof res?.created === 'number' ? res.created : 0;
          break;
        } catch (e) {
          if (ctrl.signal.aborted) return;
          const status = statusOf(e);
          if (status === 401) {
            this.onAuthLost();
            await this.waitFor('auth', ctrl.signal);
            continue; // not counted
          }
          if (this.offline) {
            await this.waitFor('online', ctrl.signal);
            continue; // not counted
          }
          if (status === 0 && !(await this.linkUp(b.target, ctrl.signal))) {
            // No answer, and nothing gets through (ISP down, Wi-Fi up): wait for
            // the link like the uploads do — not counted, never "failed".
            if (!b.linkWait) {
              b.linkWait = true;
              this.markDirty();
            }
            waits += 1;
            await this.nap(backoffMs(Math.min(waits, 6), this.deps.env.random), ctrl.signal);
            continue;
          }
          attempt += 1;
          if (classifyApi(status) === 'transient' && attempt < ENSURE_ATTEMPTS) {
            await this.nap(backoffMs(attempt, this.deps.env.random), ctrl.signal);
            continue;
          }
          b.phase = 'prepare-failed';
          b.prepareError = message(e);
          this.markDirty();
          return;
        }
      }
    }
    if (ctrl.signal.aborted) return;
    this.withMemo(() => {
      for (const { entry, dir } of plan.accepted) {
        const folderId = dir ? folders.get(dir) : b.meta.parentFolderId;
        if (dir && !folderId) {
          b.skipped.push({ path: entry.relPath, size: entry.size, kind: 'bad-folder', reason: `The folder "${dir}" could not be created.` });
          continue;
        }
        this.route(b, folderId ?? null, entry.f);
      }
    });
    b.foldersCreated = created;
    b.phase = 'ready';
    this.noteLanded(b.dataScope, [], true);
    this.afterChange();
  }

  private async ensureWithTimeout(t: QueueTarget, parent: string | null, paths: string[], outer: AbortSignal) {
    const ctrl = new AbortController();
    const stopTimer = new AbortController();
    const onOuter = () => ctrl.abort();
    outer.addEventListener('abort', onOuter, { once: true });
    void this.nap(ENSURE_TIMEOUT_MS, stopTimer.signal).then(() => {
      if (!stopTimer.signal.aborted) ctrl.abort();
    });
    try {
      return await this.deps.ensurePaths(t, parent, paths, ctrl.signal);
    } catch (e) {
      if (ctrl.signal.aborted && !(e instanceof TransportError)) throw new TransportError('Timed out', 0);
      throw e;
    } finally {
      stopTimer.abort();
      outer.removeEventListener('abort', onOuter);
    }
  }

  private nap(ms: number, signal?: AbortSignal): Promise<void> {
    return this.deps.env.sleep(ms, signal);
  }

  /** Does anything get through right now? One cheap ping (GET /health). No
   *  ping available: assume yes (the failure then counts, as before). */
  private async linkUp(t: QueueTarget, outer: AbortSignal): Promise<boolean> {
    const ping = this.transportFor(t).ping;
    if (!ping) return true;
    const ctrl = new AbortController();
    const stopTimer = new AbortController();
    const onOuter = () => ctrl.abort();
    outer.addEventListener('abort', onOuter, { once: true });
    void this.nap(PING_TIMEOUT_MS, stopTimer.signal).then(() => {
      if (!stopTimer.signal.aborted) ctrl.abort();
    });
    try {
      await ping(ctrl.signal);
      return true;
    } catch {
      return false;
    } finally {
      stopTimer.abort();
      outer.removeEventListener('abort', onOuter);
    }
  }

  private waitFor(what: 'auth' | 'online', signal: AbortSignal): Promise<void> {
    const ready = what === 'auth' ? !this.authLost : !this.offline;
    if (ready || signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const list = what === 'auth' ? this.authWaiters : this.onlineWaiters;
      const done = () => {
        signal.removeEventListener('abort', done);
        resolve();
      };
      list.push(done);
      signal.addEventListener('abort', done, { once: true });
    });
  }

  private wake(what: 'auth' | 'online'): void {
    const list = what === 'auth' ? this.authWaiters : this.onlineWaiters;
    const fns = list.splice(0);
    for (const fn of fns) fn();
  }

  // ---- internals: sign-in -----------------------------------------------------------

  private onAuthLost(): void {
    if (this.authLost) return;
    this.authLost = { tokenAtLoss: this.deps.accessToken() };
    this.pauseReasons.add('auth');
    for (const b of this.batches.values()) b.engine?.pause();
    this.markDirty();
    void this.authLoop();
  }

  private async authLoop(): Promise<void> {
    while (this.authLost) {
      await this.nap(AUTH_POLL_MS);
      if (!this.authLost) return;
      await this.pollAuth();
    }
  }

  private async pollAuth(): Promise<void> {
    if (!this.authLost) return;
    await this.deps.restoreSession().catch(() => undefined);
    const lost = this.authLost;
    if (!lost) return;
    const tok = this.deps.accessToken();
    if (!tok || tok === lost.tokenAtLoss) return;
    const sub = jwtSub(tok);
    if (this.ownerId && sub && sub !== this.ownerId) {
      this.shutdown('user-changed');
      return;
    }
    this.authLost = null;
    this.pauseReasons.delete('auth');
    this.wake('auth');
    this.afterChange();
  }

  // ---- internals: the standard-upload runner (proxy mode) ----------------------------------

  private toLegacy(rowId: string): void {
    const r = this.rows.get(rowId);
    const b = r && this.batches.get(r.batchId);
    if (!r || !b) return;
    const tooBig = r.item.source.size > LEGACY_MAX_BYTES;
    this.legacy.set(
      rowId,
      tooBig
        ? {
            status: 'failed',
            bytesDone: 0,
            error: 'Too large for the standard upload (2 GB max), which this server is using right now — Retry later.',
          }
        : { status: 'waiting', bytesDone: 0 },
    );
    b.legacyIds.add(rowId);
    if (!tooBig) this.pushLegacy(b.id, rowId);
  }

  private async runLegacy(): Promise<void> {
    if (this.legacyRunning) return;
    this.legacyRunning = true;
    try {
      while (!this.pauseReasons.size && !this.offline && !this.shut) {
        const rowId = this.pickLegacy();
        if (!rowId) break;
        const r = this.rows.get(rowId);
        const lg = this.legacy.get(rowId);
        const b = r && this.batches.get(r.batchId);
        if (!r || !lg || !b || lg.status !== 'waiting') continue;
        if (!this.sameUser()) return;
        const gen = this.gen; // (a shutdown while this row runs makes it someone else's queue)
        lg.status = 'uploading';
        const ctrl = new AbortController();
        lg.ctrl = ctrl;
        this.markDirty();
        // Stall watchdog (no progress for LEGACY_STALL_MS ⇒ abort; retried below).
        let progressed = true;
        let stalled = false;
        const stopWatch = new AbortController();
        if (lg.storedKey) stopWatch.abort(); // only recording left: nothing to stall
        const watch = (async () => {
          let quiet = 0;
          while (!stopWatch.signal.aborted) {
            await this.nap(5_000, stopWatch.signal);
            if (stopWatch.signal.aborted) return;
            quiet = progressed ? 0 : quiet + 5_000;
            progressed = false;
            if (quiet >= LEGACY_STALL_MS) {
              stalled = true;
              ctrl.abort();
              return;
            }
          }
        })();
        try {
          lg.inCall = true;
          const file = await this.deps.legacyUpload(
            b.target,
            r.item.source,
            r.item.folderId,
            (fr) => {
              progressed = true;
              lg.bytesDone = Math.round(Math.max(0, Math.min(1, fr)) * r.item.source.size);
              this.markDirty();
            },
            ctrl.signal,
            {
              // Stored already (an earlier try lost only the commit's reply): record, don't re-upload.
              commitKey: lg.storedKey,
              onStored: (key) => {
                lg.storedKey = key;
                stopWatch.abort(); // the commit is not "stalled" while the server records it
              },
            },
          );
          lg.inCall = false;
          if (gen !== this.gen) continue; // signed out / another officer since: not theirs to show
          // Recorded — even if Cancel came too late to stop it.
          lg.status = 'done';
          lg.storedKey = undefined;
          if (lg.lateCancel) lg.note = 'It was already being saved, so it could not be cancelled — delete it from the folder if unwanted.';
          lg.bytesDone = r.item.source.size;
          lg.file = file;
          if (this.sameUser()) this.noteLanded(b.dataScope, [file], false);
        } catch (e) {
          lg.inCall = false;
          if (gen !== this.gen) continue; // (as above: that queue is gone)
          const status = statusOf(e);
          const now = lg.status as LegacyRow['status']; // (Cancel may have changed it during the await)
          if (now === 'cancelled') {
            // The officer stopped it (or signed out).
          } else if (lg.lateCancel) {
            // Cancelled while it was being recorded, and the recording failed —
            // or only its reply got lost. Don't try again; say what to check.
            lg.status = 'cancelled';
            lg.note = 'It may already have been saved — check the folder and delete it if unwanted.';
          } else if (status === 401) {
            lg.status = 'waiting';
            lg.bytesDone = 0;
            this.pushLegacy(b.id, rowId, true);
            this.onAuthLost();
          } else if (stalled || status === 0 || classifyApi(status) === 'transient') {
            // No answer / a stall / 5xx: the link, or this upload? Only counts while the link works.
            const up = await this.linkUp(b.target, b.ctrl.signal);
            // Cancelled (or signed out) while we asked: nothing more for this row.
            if (gen !== this.gen || (lg.status as LegacyRow['status']) === 'cancelled') continue;
            if (up) lg.tries = (lg.tries ?? 0) + 1;
            if (up && (lg.tries ?? 0) >= LEGACY_ATTEMPTS) {
              lg.status = 'failed';
              lg.error = stalled ? 'The upload stopped responding.' : message(e);
            } else {
              lg.status = 'waiting';
              lg.bytesDone = lg.storedKey ? r.item.source.size : 0;
              this.pushLegacy(b.id, rowId, true);
              this.markDirty();
              await this.nap(backoffMs(up ? (lg.tries ?? 1) * 2 : 5, this.deps.env.random), b.ctrl.signal);
            }
          } else {
            lg.status = 'failed';
            lg.error = message(e);
          }
        } finally {
          stopWatch.abort();
          await watch;
          if (lg.ctrl === ctrl) lg.ctrl = undefined;
        }
        this.markDirty();
      }
    } finally {
      this.legacyRunning = false;
    }
  }

  // ---- internals: snapshot ----------------------------------------------------------------

  private noteLanded(scope: string, files: unknown[], foldersChanged: boolean): void {
    let p = this.pendingLanded.get(scope);
    if (!p) this.pendingLanded.set(scope, (p = { files: [], foldersChanged: false }));
    p.files.push(...files.filter(Boolean));
    p.foldersChanged ||= foldersChanged;
  }

  private afterChange(): void {
    this.reconcile();
    this.markDirty();
  }

  /** Coalesce engine notifications into ≤ 4 snapshots a second. */
  private markDirty(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    // Clamped: a PC clock set BACK must not postpone the next snapshot by hours.
    const wait = Math.min(FLUSH_MS, this.lastFlushAt + FLUSH_MS - this.deps.env.now());
    if (wait <= 0) {
      queueMicrotask(() => this.flush());
    } else {
      const t = new AbortController();
      this.flushTimer = t;
      void this.nap(wait, t.signal).then(() => {
        if (!t.signal.aborted) this.flush();
      });
    }
  }

  private flush(): void {
    this.withMemo(() => this.flushNow());
  }

  private flushNow(): void {
    this.flushScheduled = false;
    this.flushTimer = null;
    this.lastFlushAt = this.deps.env.now();
    const now = this.deps.env.now();
    const batchViews: BatchView[] = [];
    const allRows: RowView[] = [];
    let linkDown = false;
    let readsWaiting = false;
    // One engine snapshot per batch per flush. Rows the server sent to the
    // standard upload ('proxy' answers) move over first, so the views below
    // (and hasWork) already see them there.
    const snaps = new Map<Batch, ReturnType<UploadEngine['snapshot']>>();
    for (const b of this.batches.values()) {
      const snap = b.engine?.snapshot();
      if (!snap) continue;
      snaps.set(b, snap);
      for (const f of snap.files) {
        if (f.status !== 'fallback') continue;
        const id = `${b.id}\u0001${f.key}`;
        if (this.rows.has(id) && !this.legacy.has(id)) this.moveToLegacy(id);
      }
    }
    this.workMemo?.clear();
    for (const b of this.batches.values()) {
      const snap = snaps.get(b);
      if (snap?.linkDown || b.linkWait) linkDown = true;
      if (snap?.readsWaiting && this.hasWork(b)) readsWaiting = true; // (a finished / cancelled drop's wait is over)
      const byKey = new Map((snap?.files ?? []).map((f) => [f.key, f]));
      const pendingKeys = new Set(b.pending.map((it) => it.key));
      const rows: RowView[] = [];
      for (const rowId of b.rowIds) {
        const r = this.rows.get(rowId);
        if (!r) continue;
        const lg = this.legacy.get(rowId);
        const base = {
          rowId,
          batchId: b.id,
          folderId: r.item.folderId,
          key: r.key,
          fileName: r.item.fileName,
          relativePath: r.item.relativePath,
          size: r.item.source.size,
          hashedBytes: 0,
        };
        let view: RowView;
        if (lg) {
          view = {
            ...base,
            status: lg.status === 'waiting' ? 'queued' : lg.status,
            bytesDone: lg.bytesDone,
            bytesInFlight: 0,
            error: lg.error,
            retryable: lg.status === 'failed' ? true : undefined,
            file: lg.file,
            note: lg.note,
            legacy: true,
          };
        } else if (byKey.has(r.key) && !pendingKeys.has(r.key)) {
          const v = byKey.get(r.key)!;
          view = { ...v, rowId, batchId: b.id, folderId: r.item.folderId };
          if (v.status === 'fallback') view = { ...view, status: 'queued', legacy: true }; // (never shown raw)
        } else {
          view = { ...base, status: 'queued', bytesDone: 0, bytesInFlight: 0 };
        }
        const prev = this.lastStatus.get(rowId);
        if (view.status === 'done' && prev !== 'done' && !lg && view.file) this.noteLanded(b.dataScope, [view.file], false);
        this.lastStatus.set(rowId, view.status);
        rows.push(view);
        allRows.push(view);
      }
      const work = this.hasWork(b);
      let state: BatchState;
      if (b.phase === 'preparing') state = 'preparing';
      else if (b.phase === 'prepare-failed') state = 'prepare-failed';
      else if (work) {
        const running = this.isExpress(b) || b.id === this.runningBig;
        state = !running ? 'waiting-turn' : this.pauseReasons.has('user') ? 'paused' : 'running';
      } else if (rows.some((x) => x.status === 'needs-decision')) state = 'needs-you';
      else state = 'finished';
      batchViews.push({
        id: b.id,
        label: b.meta.label,
        href: b.meta.href,
        parentLabel: b.meta.parentLabel,
        kind: b.kind,
        rootNames: b.rootNames,
        dataScope: b.dataScope,
        state,
        prepareError: b.prepareError,
        rows,
        skipped: b.skipped,
        alreadyListed: b.alreadyListed,
        foldersCreated: b.foldersCreated,
        summary: summarize(rows),
        createdAt: b.createdAt,
      });
    }
    const summary = summarize(allRows);
    const active = [...this.batches.values()].some((b) => this.hasWork(b));
    if (active && this.activeSince === null) this.activeSince = now;
    if (!active) {
      this.activeSince = null;
      this.speed.reset();
    } else {
      this.speed.sample(this.wireBytes, now);
    }
    const halted = this.pauseReasons.size > 0 || this.offline;
    const eta =
      active && !halted && this.activeSince !== null && now - this.activeSince >= 5000
        ? this.speed.etaSeconds(Math.max(0, summary.bytesTotal - summary.bytesSent))
        : null;
    const notUploaded = batchViews.reduce((n, b) => n + b.skipped.length, 0);
    const checks = batchViews.reduce((n, b) => n + b.rows.filter(needsCheck).length, 0);
    const attention =
      summary.failed + summary.needsDecision + notUploaded + checks + batchViews.filter((b) => b.state === 'prepare-failed').length;
    const running = this.runningBig ? this.batches.get(this.runningBig) : undefined;
    this.snapshot = Object.freeze({
      rev: this.snapshot.rev + 1,
      batches: batchViews.reverse(), // newest first
      summary,
      paused: this.pauseReasons.has('user'),
      offline: this.offline,
      linkDown,
      authLost: !!this.authLost,
      compat: this.proxyBases.size > 0,
      active,
      bytesPerSecond: active ? this.speed.bytesPerSecond : 0,
      etaSeconds: eta,
      attention,
      runningLabel: running?.meta.label,
      readsWaiting,
      notice: this.notice,
    });
    for (const fn of this.subscribers) fn();
    this.emitLanded();
    this.reconcile();
    void this.runLegacy();
  }

  /** The server answered 'proxy' for THIS file (dev storage / kill switch): it
   *  goes to the standard upload. Nothing else moves without its own answer —
   *  a file whose session is still finishing must never be uploaded twice. */
  private moveToLegacy(rowId: string): void {
    if (this.legacy.has(rowId)) return;
    const r = this.rows.get(rowId);
    const b = r && this.batches.get(r.batchId);
    if (!r || !b) return;
    this.proxyBases.add(b.target.base); // (the dock says the standard upload is in use)
    if (b.ctrl.signal.aborted) {
      // The officer cancelled this drop: nothing more goes up.
      this.legacy.set(rowId, { status: 'cancelled', bytesDone: 0 });
      b.legacyIds.add(rowId);
    } else {
      this.toLegacy(rowId);
    }
    this.markDirty();
  }

  private emitLanded(): void {
    const scopes = new Set([...this.landedListeners.keys(), ...this.pendingLanded.keys(), ...this.scopeBusy.keys()]);
    for (const scope of scopes) {
      const busy = [...this.batches.values()].some((b) => b.dataScope === scope && this.hasWork(b));
      const wasBusy = this.scopeBusy.get(scope) ?? false;
      this.scopeBusy.set(scope, busy);
      const p = this.pendingLanded.get(scope);
      this.pendingLanded.delete(scope);
      const idle = wasBusy && !busy;
      if (!p && !idle) continue;
      const e: LandedEvent = { files: p?.files ?? [], foldersChanged: p?.foldersChanged ?? false, idle };
      for (const fn of this.landedListeners.get(scope) ?? []) fn(e);
    }
  }
}
