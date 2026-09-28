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
  /** The standard (≤ 2 GB) upload, for proxy mode. */
  legacyUpload(t: QueueTarget, file: UploadSource, folderId: string | null, onProgress: (fraction: number) => void): Promise<unknown>;
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
  private readonly legacyQueue: string[] = [];
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
    for (const { f } of ordered) this.route(b, meta.parentFolderId, f);
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
      if (lg.status === 'waiting') {
        lg.status = 'cancelled';
        this.afterChange();
      }
      return; // an uploading standard upload cannot be stopped mid-way
    }
    const i = b.pending.findIndex((it) => it.key === r.key);
    if (i >= 0) {
      b.pending.splice(i, 1);
      this.legacy.set(rowId, { status: 'cancelled', bytesDone: 0 }); // shown as a cancelled row
      this.afterChange();
      return;
    }
    await b.engine?.cancel(r.key);
    this.afterChange();
  }

  /** Remove a failed row. If another live row (a re-dropped copy) is using its
   *  server session, only this row goes — the copy's upload is untouched. */
  async discard(rowId: string): Promise<void> {
    const r = this.rows.get(rowId);
    const b = r && this.batches.get(r.batchId);
    if (!r || !b?.engine) return;
    const view = b.engine.snapshot().files.find((f) => f.key === r.key);
    if (!view || view.status !== 'failed') return;
    const shared =
      !!view.uploadId &&
      [...this.batches.values()].some(
        (o) => o !== b && o.engine?.snapshot().files.some((f) => f.uploadId === view.uploadId && LIVE.has(f.status)),
      );
    if (shared) this.legacy.set(rowId, { status: 'cancelled', bytesDone: 0 });
    else await b.engine.cancel(r.key);
    this.afterChange();
  }

  async cancelBatch(batchId: string): Promise<void> {
    const b = this.batches.get(batchId);
    if (!b) return;
    b.ctrl.abort();
    for (const rowId of b.rowIds) {
      const lg = this.legacy.get(rowId);
      if (lg?.status === 'waiting') lg.status = 'cancelled';
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
      const keys = engine
        .snapshot()
        .files.filter((f) => WORK.has(f.status) || f.status === 'needs-decision' || f.status === 'failed')
        .map((f) => f.key);
      // A pool of 4 at a time — not 1,800 DELETEs at once.
      let next = 0;
      const worker = async () => {
        while (next < keys.length) {
          const k = keys[next++];
          await engine.cancel(k);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CANCEL_POOL, keys.length) }, worker));
    }
    this.afterChange();
  }

  async cancelAll(): Promise<void> {
    await Promise.all([...this.batches.keys()].map((id) => this.cancelBatch(id)));
  }

  retry(rowId: string): void {
    const r = this.rows.get(rowId);
    const b = r && this.batches.get(r.batchId);
    if (!r || !b) return;
    const lg = this.legacy.get(rowId);
    if (lg && (lg.status === 'failed' || lg.status === 'cancelled')) {
      if (b.engine?.snapshot().files.some((f) => f.key === r.key)) {
        this.legacy.delete(rowId); // a cancelled PENDING row: give it back to the engine
        b.engine.retry(r.key);
      } else if (this.proxyBases.has(b.target.base)) {
        lg.status = 'waiting';
        lg.error = undefined;
        this.legacyQueue.push(rowId);
      } else {
        this.legacy.delete(rowId);
        b.pending.push(r.item);
      }
      this.afterChange();
      return;
    }
    b.engine?.retry(r.key);
    this.afterChange();
  }

  retryFailed(batchId?: string): void {
    for (const b of this.batches.values()) {
      if (batchId && b.id !== batchId) continue;
      b.engine?.retryFailed();
      for (const rowId of b.rowIds) {
        const lg = this.legacy.get(rowId);
        if (lg?.status === 'failed') this.retry(rowId);
      }
    }
    this.afterChange();
  }

  resolveDuplicate(rowId: string, choice: 'skip' | 'upload'): void {
    const r = this.rows.get(rowId);
    const b = r && this.batches.get(r.batchId);
    if (!r || !b?.engine) return;
    b.engine.resolveDuplicate(r.key, choice);
    this.afterChange();
  }

  /** Remove a finished batch from the dock (not while anything still needs doing). */
  dismissBatch(batchId: string): void {
    const b = this.batches.get(batchId);
    if (!b || !this.canDismiss(b)) return;
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

  clearFinished(): void {
    for (const b of [...this.batches.values()]) if (this.canDismiss(b)) this.dismissBatch(b.id);
  }

  /** Sign-out / another user: stop everything, locally. No DELETE is sent —
   *  the server keeps the sessions for 6 days, so dropping the same files again
   *  (after signing back in) continues where they stopped. */
  shutdown(_reason: 'logout' | 'user-changed'): void {
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
    this.batches.clear();
    this.rows.clear();
    this.owner.clear();
    this.legacy.clear();
    this.legacyQueue.length = 0;
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
    this.snapshot = { ...EMPTY_SNAPSHOT, rev: this.snapshot.rev + 1 };
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
    this.ownerId = sub;
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
        const lg = this.legacy.get(existingId!);
        if (lg) {
          this.legacy.delete(existingId!);
          if (this.proxyBases.has(ob.target.base)) this.toLegacy(existingId!);
          else if (ob.engine?.snapshot().files.some((v) => v.key === key)) ob.engine.add([item]);
          else ob.pending.push(item);
        } else if (ob.engine) {
          ob.engine.add([item]);
        } else {
          const i = ob.pending.findIndex((it) => it.key === key);
          if (i >= 0) ob.pending[i] = item;
          else ob.pending.push(item);
        }
        b.alreadyListed += 1;
        return;
      }
    }
    const rowId = `${b.id}\u0001${key}`;
    this.rows.set(rowId, { batchId: b.id, key, item });
    this.owner.set(ownerKey, rowId);
    b.rowIds.push(rowId);
    b.totalBytes += f.file.size;
    if (this.proxyBases.has(b.target.base)) this.toLegacy(rowId);
    else b.pending.push(item);
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
    for (const rowId of b.rowIds) {
      const lg = this.legacy.get(rowId);
      if (lg) {
        if (lg.status === 'waiting' || lg.status === 'uploading') return true;
        continue;
      }
    }
    if (b.engine) {
      for (const f of b.engine.snapshot().files) {
        if (f.status === 'fallback') continue;
        if (WORK.has(f.status)) return true;
      }
    }
    return false;
  }

  private canDismiss(b: Batch): boolean {
    if (b.phase === 'preparing' || this.hasWork(b)) return false;
    for (const f of b.engine?.snapshot().files ?? []) {
      if (f.status === 'needs-decision') return false;
      if (f.status === 'failed' && f.retryable !== false) return false;
    }
    return true;
  }

  /** Who may run: every express batch with work + ONE big batch (sticky). */
  private reconcile(): void {
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
      if (this.shut || gen !== this.gen) throw new TransportError('Stopped', 499);
      try {
        return await fn();
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
          if (res && res.mode === 'proxy') this.proxyBases.add(t.base);
          return res;
        }),
      signParts: (id, parts, signal) => guard(() => inner.signParts(id, parts, signal)),
      complete: (ids, signal) => guard(() => inner.complete(ids, signal)),
      abort: (id, signal) => guard(() => inner.abort(id, signal)),
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
      for (;;) {
        if (ctrl.signal.aborted) return;
        try {
          const res = await this.ensureWithTimeout(b.target, b.meta.parentFolderId, chunk, ctrl.signal);
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
    for (const { entry, dir } of plan.accepted) {
      const folderId = dir ? folders.get(dir) : b.meta.parentFolderId;
      if (dir && !folderId) {
        b.skipped.push({ path: entry.relPath, size: entry.size, kind: 'bad-folder', reason: `The folder "${dir}" could not be created.` });
        continue;
      }
      this.route(b, folderId ?? null, entry.f);
    }
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
    if (!r) return;
    const tooBig = r.item.source.size > LEGACY_MAX_BYTES;
    this.legacy.set(
      rowId,
      tooBig
        ? { status: 'failed', bytesDone: 0, error: 'Too large for the standard upload (2 GB max) — this server can’t take bigger files right now.' }
        : { status: 'waiting', bytesDone: 0 },
    );
    if (!tooBig) this.legacyQueue.push(rowId);
  }

  private async runLegacy(): Promise<void> {
    if (this.legacyRunning) return;
    this.legacyRunning = true;
    try {
      while (this.legacyQueue.length && !this.pauseReasons.size && !this.offline && !this.shut) {
        const rowId = this.legacyQueue.shift()!;
        const r = this.rows.get(rowId);
        const lg = this.legacy.get(rowId);
        const b = r && this.batches.get(r.batchId);
        if (!r || !lg || !b || lg.status !== 'waiting') continue;
        lg.status = 'uploading';
        this.markDirty();
        try {
          const file = await this.deps.legacyUpload(b.target, r.item.source, r.item.folderId, (fr) => {
            lg.bytesDone = Math.round(Math.max(0, Math.min(1, fr)) * r.item.source.size);
            this.markDirty();
          });
          lg.status = 'done';
          lg.bytesDone = r.item.source.size;
          lg.file = file;
          this.noteLanded(b.dataScope, [file], false);
        } catch (e) {
          if (statusOf(e) === 401) {
            lg.status = 'waiting';
            lg.bytesDone = 0;
            this.legacyQueue.unshift(rowId);
            this.onAuthLost();
          } else {
            lg.status = 'failed';
            lg.error = message(e);
          }
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
    const wait = this.lastFlushAt + FLUSH_MS - this.deps.env.now();
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
    this.flushScheduled = false;
    this.flushTimer = null;
    this.lastFlushAt = this.deps.env.now();
    const now = this.deps.env.now();
    const batchViews: BatchView[] = [];
    const allRows: RowView[] = [];
    let linkDown = false;
    let fallbacks: string[] = [];
    for (const b of this.batches.values()) {
      const snap = b.engine?.snapshot();
      if (snap?.linkDown) linkDown = true;
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
            retryable: lg.status === 'failed' ? !lg.error?.startsWith('Too large') : undefined,
            file: lg.file,
            legacy: true,
          };
        } else if (byKey.has(r.key) && !pendingKeys.has(r.key)) {
          const v = byKey.get(r.key)!;
          view = { ...v, rowId, batchId: b.id, folderId: r.item.folderId };
          if (v.status === 'fallback') {
            fallbacks.push(rowId);
            view = { ...view, status: 'queued', legacy: true }; // moving to the standard upload
          }
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
    // Rows the server sent to the standard upload (proxy mode).
    for (const rowId of fallbacks) this.moveToLegacy(rowId);

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
    const attention =
      summary.failed + summary.needsDecision + batchViews.filter((b) => b.state === 'prepare-failed').length;
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
    });
    for (const fn of this.subscribers) fn();
    this.emitLanded();
    this.reconcile();
    void this.runLegacy();
  }

  private moveToLegacy(rowId: string): void {
    if (this.legacy.has(rowId)) return;
    const r = this.rows.get(rowId);
    const b = r && this.batches.get(r.batchId);
    if (!r || !b) return;
    this.proxyBases.add(b.target.base);
    // Everything else for this portal that hasn't started goes the same way.
    for (const ob of this.batches.values()) {
      if (ob.target.base !== b.target.base) continue;
      for (const it of ob.pending.splice(0)) {
        const id = `${ob.id}\u0001${it.key}`;
        if (this.rows.has(id)) this.toLegacy(id);
      }
      for (const f of ob.engine?.snapshot().files ?? []) {
        const id = `${ob.id}\u0001${f.key}`;
        if (id === rowId || this.legacy.has(id) || !this.rows.has(id)) continue;
        if (!f.uploadId && (f.status === 'queued' || f.status === 'hashing' || f.status === 'hashed' || f.status === 'fallback')) {
          void ob.engine!.cancel(f.key); // local: no session yet — stops its hash worker
          this.toLegacy(id);
        }
      }
    }
    this.toLegacy(rowId);
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
