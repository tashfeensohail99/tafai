/**
 * The databank upload engine (Databank Phase 1 — docs/databank-phase1-resumable-uploads.md §4).
 *
 * Drives many files from "dropped" to "recorded in the databank":
 *   hash (SHA-256, off-thread) → init (batched ≤50) → PUT parts straight to R2
 *   with presigned URLs → complete (batched ≤50)
 * surviving what an office link does to a 20 GB Drive export: dropped
 * connections, load-shedding outages, stalls, throttling, expired URLs, a tab
 * that resumes days later.
 *
 * Pure orchestration: the network (UploadTransport) and time/hashing
 * (EngineEnv) are injected, so tests drive it with a fake server + R2 that
 * injects 403s, stalls, 5xx, outages and silence, and assert every part lands
 * exactly once. No React, no DOM — the dock subscribes to snapshot().
 *
 * Rules it keeps:
 *  - A part is confirmed only by a 2xx PUT; the SERVER re-verifies every part
 *    (ListParts) before it records the file, so a mistake here can't corrupt data.
 *  - OUTAGES DON'T FAIL FILES. A failure only uses up a retry attempt when other
 *    requests on the same channel (storage / our API) are demonstrably getting
 *    through; while nothing gets through, files wait (backoff capped at 30 s)
 *    for up to 12 h. `setOnline(false)` (the browser's offline event) halts all
 *    work at once. Only errors that can never succeed stop a file straight away.
 *  - Global part slots (adaptive 2–6, AIMD: halve on trouble, +1 after a run of
 *    successes), filled from the OLDEST active file first.
 *  - Nothing storage already has is re-sent (init's doneParts); an identical
 *    file twice in one drop is uploaded once.
 *  - Every request has a timeout, and stops when the engine is halted.
 *  - Cancel never lies: a file the server is already recording ends "done"
 *    (with a note), not "cancelled".
 */

import type {
  CompleteResponse,
  CompleteResult,
  ExistingFile,
  InitResponse,
  InitResult,
  InitUploadFile,
  PartUrl,
  SignPartsResponse,
} from './api-types.ts';
import { MAX_COMPLETE_IDS, MAX_INIT_FILES, MAX_SIGN_PARTS } from './api-types.ts';
import { bytesOf, partRange, partsToSend } from './parts.ts';
import { backoffMs, classifyApi, classifyPut } from './retry.ts';

// ---------------------------------------------------------------------------
// Injected dependencies
// ---------------------------------------------------------------------------

/** What the engine uploads: a File in the browser, a fake in tests. */
export interface UploadSource {
  readonly size: number;
  slice(start: number, end: number): unknown;
}

export interface UploadItem {
  /** Caller-chosen unique key (e.g. relative path + size + lastModified). */
  key: string;
  source: UploadSource;
  fileName: string;
  mimeType: string;
  relativePath?: string;
  folderId: string | null;
  lastModified?: number;
}

/** A failed request. `status` is the HTTP status, 0 when there was no response
 *  (offline, reset, timeout, abort, unreadable reply). */
export class TransportError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TransportError';
    this.status = status;
  }
}

/** Every call takes an AbortSignal (timeouts, halt, cancel) and must reject
 *  with a TransportError once it fires. */
export interface UploadTransport {
  init(files: InitUploadFile[], signal: AbortSignal): Promise<InitResponse>;
  signParts(uploadId: string, partNumbers: number[], signal: AbortSignal): Promise<SignPartsResponse>;
  complete(uploadIds: string[], signal: AbortSignal): Promise<CompleteResponse>;
  abort(uploadId: string, signal: AbortSignal): Promise<void>;
  /** PUT one part to its presigned URL; reject with TransportError on non-2xx. */
  put(part: PartUrl, body: unknown, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<void>;
}

export interface EngineEnv {
  now(): number;
  /** Resolve after `ms`, or early (never rejecting) when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  random(): number;
  /** Lower-case hex SHA-256 of the whole source (in a Worker in the browser). */
  hash(source: UploadSource, onProgress: (bytes: number) => void, signal: AbortSignal): Promise<string>;
}

export interface EngineOptions {
  /** Starting part concurrency (default 4), adapted between min and max. */
  slots?: number;
  minSlots?: number;
  maxSlots?: number;
  /** Files hashed at once (default 1 — hashing is CPU, the network is the bottleneck). */
  hashConcurrency?: number;
  /** Files whose parts may be in flight at once (default 6). */
  maxActiveFiles?: number;
  /** Initialised-but-waiting files to keep ahead of the uploader (default 8). */
  readyAhead?: number;
  /** Give up on a request that has failed this long with nothing getting through (default 12 h). */
  giveUpMs?: number;
}

// ---------------------------------------------------------------------------
// Public state
// ---------------------------------------------------------------------------

export type FileStatus =
  | 'queued' //         waiting to be hashed
  | 'hashing'
  | 'hashed' //         waiting for init
  | 'ready' //          session open, waiting for a part slot
  | 'uploading'
  | 'completing' //     all parts sent, server is recording it
  | 'cancelling' //     asking the server to discard it
  | 'done' //           recorded in the databank
  | 'skipped' //        already there (or the same file twice in this drop)
  | 'needs-decision' // a duplicate elsewhere — skip or upload anyway?
  | 'handed-off' //     uploaded; the server is still assembling it and will finish on its own
  | 'fallback' //       dev storage: upload this one the legacy way
  | 'failed'
  | 'cancelled';

export interface FileView {
  key: string;
  fileName: string;
  relativePath?: string;
  size: number;
  status: FileStatus;
  /** Bytes storage has confirmed (whole parts). Kept on failure: Retry resumes them. */
  bytesDone: number;
  /** Bytes of parts currently in flight (may be discarded on failure). */
  bytesInFlight: number;
  hashedBytes: number;
  uploadId?: string;
  resumed?: boolean;
  relocated?: boolean;
  /** For skipped / needs-decision: the file the databank already holds. */
  existing?: ExistingFile;
  duplicateKind?: 'already-uploaded' | 'duplicate' | 'possible-duplicate' | 'same-drop';
  /** Failed: why, and whether "Retry" can help. */
  error?: string;
  retryable?: boolean;
  /** Extra context for the row (e.g. "already saved — could not be cancelled"). */
  note?: string;
  /** Done: the recorded file row. */
  file?: unknown;
}

export interface EngineSnapshot {
  files: FileView[];
  paused: boolean;
  /** The browser reported the connection offline (setOnline(false)). */
  offline: boolean;
  /** Several requests in a row got no answer and nothing got through: "Waiting for the network…". */
  linkDown: boolean;
  slots: number;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** A PUT with no progress for this long is aborted and retried. */
export const STALL_MS = 60_000;
const STALL_CHECK_MS = 5_000;
/** Attempts per part — counted only while other PUTs get through. */
export const MAX_PART_ATTEMPTS = 8;
/** Attempts per API request — counted only while other API calls get through. */
const MAX_API_ATTEMPTS = 6;
/** Default give-up for a request failing with nothing getting through at all. */
export const GIVE_UP_MS = 12 * 3600_000;
/** Re-signs of one part in a row before a 403 is treated as final. */
const MAX_RESIGNS = 3;
/** Server "try again" / "in progress" / no-answer follow-ups per file. */
const MAX_FOLLOW_UPS = 40;
/** Times one file may be re-initialised (session lost / expired). */
const MAX_REINITS = 2;
/** Upload → missing-parts → upload cycles per file. */
const MAX_COMPLETE_CYCLES = 3;
/** Successes in a row before one more part slot is tried. */
const GROW_AFTER = 8;
/** Failures in a row, with nothing getting through, before the link counts as down. */
const LINK_DOWN_AFTER = 3;
/** Request timeouts. A timed-out complete keeps running on the server (a later
 *  complete follows it), so none of these can lose work. */
export const INIT_TIMEOUT_MS = 60_000;
const SIGN_TIMEOUT_MS = 60_000;
const COMPLETE_TIMEOUT_MS = 120_000;
const ABORT_TIMEOUT_MS = 30_000;
/** A URL is refreshed when it expires within this, and is not brand new
 *  (the second clause stops a skewed client clock re-signing forever). */
const URL_REFRESH_MS = 120_000;
const URL_MIN_AGE_MS = 60_000;
/** Server field limits (databank-upload.dto.ts) — checked here so one bad file
 *  can't 400 a whole batch. */
const MAX_FILE_NAME = 255;
const MAX_MIME = 255;
const MAX_RELATIVE_PATH = 1024;
const MAX_LAST_MODIFIED = 8.64e15;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface Session {
  id: string;
  partSize: number;
  partCount: number;
}

interface InFlight {
  ctrl: AbortController;
  loaded: number;
  lastProgressAt: number;
  /** Why we aborted it, if we did. */
  reason?: 'stall' | 'stop';
}

/** Retry accounting for one request that tolerates outages. */
interface Budget {
  /** Failures that happened while the channel was demonstrably up. */
  counted: number;
  /** All failures (drives the backoff delay). */
  tries: number;
  firstFailureAt: number | null;
}

const newBudget = (): Budget => ({ counted: 0, tries: 0, firstFailureAt: null });

type Channel = 'storage' | 'api';

interface Job {
  item: UploadItem;
  view: FileView;
  sha256?: string;
  allowDuplicate: boolean;
  /** Bumped whenever the job is reset (cancel, retry, re-init, detach): stale
   *  async callbacks compare their captured generation and back off. */
  gen: number;
  /** Aborted (and replaced) with every generation: ends that generation's sleeps and calls. */
  wake: AbortController;
  session?: Session;
  /** Parts waiting for a slot. */
  pending: number[];
  inflight: Map<number, InFlight>;
  /** Parts backing off after a transient failure (neither pending nor in
   *  flight — but NOT done: the file must not complete while any cool down). */
  cooling: Set<number>;
  done: Set<number>;
  urls: Map<number, { part: PartUrl; fetchedAt: number; expiresAt: number }>;
  signing?: Promise<void>;
  partBudgets: Map<number, Budget>;
  signBudget: Budget;
  resigns: Map<number, number>;
  followUps: number;
  reinits: number;
  completeCycles: number;
  /** Queued for the next complete batch. */
  wantsComplete: boolean;
  /** Backing off after a server "try again" — init/complete leave it alone. */
  parked: boolean;
  /** Init this file on its own (its batch was rejected as a whole). */
  soloInit: boolean;
  /** The officer cancelled it but the server was already recording it. */
  cancelRequested: boolean;
  hashCtrl?: AbortController;
}

const TERMINAL: ReadonlySet<FileStatus> = new Set([
  'done', 'skipped', 'handed-off', 'fallback', 'failed', 'cancelled',
]);

/** Call `onAbort` when any of `signals` aborts; returns an unlink function. */
function link(signals: Array<AbortSignal | undefined>, onAbort: () => void): () => void {
  const live = signals.filter((s): s is AbortSignal => !!s);
  if (live.some((s) => s.aborted)) {
    onAbort();
    return () => undefined;
  }
  for (const s of live) s.addEventListener('abort', onAbort, { once: true });
  return () => {
    for (const s of live) s.removeEventListener('abort', onAbort);
  };
}

export class UploadEngine {
  private readonly transport: UploadTransport;
  private readonly env: EngineEnv;
  private readonly minSlots: number;
  private readonly maxSlots: number;
  private readonly hashConcurrency: number;
  private readonly maxActiveFiles: number;
  private readonly readyAhead: number;
  private readonly giveUpMs: number;

  private readonly jobs: Job[] = [];
  private readonly byKey = new Map<string, Job>();
  private slots: number;
  private successStreak = 0;
  private paused = false;
  private offline = false;
  /** Aborted whenever the engine halts (pause / offline): ends sleeps and calls. */
  private haltCtrl = new AbortController();
  /** Per channel: when a request last got through, and failures in a row since. */
  private readonly lastSuccessAt: Record<Channel, number> = { storage: -Infinity, api: -Infinity };
  private readonly failuresInARow: Record<Channel, number> = { storage: 0, api: 0 };
  /** Work in flight: hashes, API calls, part slots, back-off sleeps, cancels. */
  private hashing = 0;
  private initInFlight = false;
  private completeInFlight = false;
  private busySlots = 0;
  private sleeping = 0;
  private cancelling = 0;
  private scheduled = false;
  private readonly listeners = new Set<() => void>();
  private idleWaiters: Array<() => void> = [];

  constructor(transport: UploadTransport, env: EngineEnv, opts: EngineOptions = {}) {
    this.transport = transport;
    this.env = env;
    this.minSlots = opts.minSlots ?? 2;
    this.maxSlots = opts.maxSlots ?? 6;
    this.slots = Math.min(this.maxSlots, Math.max(this.minSlots, opts.slots ?? 4));
    this.hashConcurrency = opts.hashConcurrency ?? 1;
    this.maxActiveFiles = opts.maxActiveFiles ?? 6;
    this.readyAhead = opts.readyAhead ?? 8;
    this.giveUpMs = opts.giveUpMs ?? GIVE_UP_MS;
  }

  // ---- public API -----------------------------------------------------------

  /** Queue files. Re-dropping a queued file is harmless; re-dropping a failed or
   *  cancelled one retries it. */
  add(items: UploadItem[]): void {
    for (const item of items) {
      const known = this.byKey.get(item.key);
      if (known) {
        if (known.view.status === 'failed' || known.view.status === 'cancelled') this.retry(item.key);
        continue;
      }
      const job: Job = {
        item,
        view: {
          key: item.key,
          fileName: item.fileName,
          relativePath: item.relativePath,
          size: item.source.size,
          status: 'queued',
          bytesDone: 0,
          bytesInFlight: 0,
          hashedBytes: 0,
        },
        allowDuplicate: false,
        gen: 0,
        wake: new AbortController(),
        pending: [],
        inflight: new Map(),
        cooling: new Set(),
        done: new Set(),
        urls: new Map(),
        partBudgets: new Map(),
        signBudget: newBudget(),
        resigns: new Map(),
        followUps: 0,
        reinits: 0,
        completeCycles: 0,
        wantsComplete: false,
        parked: false,
        soloInit: false,
        cancelRequested: false,
      };
      this.jobs.push(job);
      this.byKey.set(item.key, job);
    }
    this.schedule();
  }

  /** Stop sending: in-flight requests are aborted (and re-sent on resume). */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.halt();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.unhalt();
  }

  /** Feed the browser's online/offline events: offline halts everything at once
   *  (no retries burn), online picks up where it left off. */
  setOnline(online: boolean): void {
    if (online === !this.offline) return;
    this.offline = !online;
    if (this.offline) {
      this.halt();
    } else {
      this.failuresInARow.storage = 0;
      this.failuresInARow.api = 0;
      this.unhalt();
    }
  }

  /**
   * Cancel one file (also a FAILED one, discarding the parts it kept for a
   * retry): stop sending, then ask the server to discard the session. If the
   * server is already recording the file (409), the row follows it to "done"
   * with a note instead of pretending it was cancelled.
   */
  async cancel(key: string): Promise<void> {
    const job = this.byKey.get(key);
    if (!job) return;
    const s = job.view.status;
    if (s === 'cancelling' || (TERMINAL.has(s) && s !== 'failed')) return;
    const sessionId = job.session?.id ?? job.view.uploadId;
    if (!sessionId) {
      this.reset(job);
      this.set(job, { status: 'cancelled' });
      this.schedule();
      return;
    }
    this.detachParts(job);
    job.parked = false;
    job.wantsComplete = false;
    const gen = job.gen;
    this.set(job, { status: 'cancelling' });
    this.cancelling += 1;
    this.schedule();
    try {
      const outcome = await this.abortSession(sessionId);
      if (job.gen !== gen) return;
      if (outcome === 'finishing') {
        job.cancelRequested = true;
        this.set(job, {
          note: 'It was already being saved, so it could not be cancelled — delete it from the folder if unwanted.',
        });
        this.toComplete(job, sessionId);
        return;
      }
      this.reset(job);
      this.set(job, {
        status: 'cancelled',
        note: outcome === 'unknown' ? 'Cancelled here; the server will discard the upload.' : undefined,
      });
    } finally {
      this.cancelling -= 1;
      this.schedule();
    }
  }

  async cancelAll(): Promise<void> {
    await Promise.all(this.jobs.map((j) => this.cancel(j.item.key)));
  }

  /** Try a failed (or cancelled) file again: a fresh init resumes whatever
   *  storage still holds for it. */
  retry(key: string): void {
    const job = this.byKey.get(key);
    if (!job || (job.view.status !== 'failed' && job.view.status !== 'cancelled')) return;
    this.reset(job);
    job.reinits = 0;
    job.followUps = 0;
    job.completeCycles = 0;
    job.soloInit = false;
    job.cancelRequested = false;
    this.set(job, {
      status: job.sha256 ? 'hashed' : 'queued',
      error: undefined,
      retryable: undefined,
      note: undefined,
    });
    this.schedule();
  }

  retryFailed(): void {
    for (const j of this.jobs) if (j.view.status === 'failed' && j.view.retryable !== false) this.retry(j.item.key);
  }

  /** Answer a duplicate prompt: skip it, or upload it anyway. */
  resolveDuplicate(key: string, choice: 'skip' | 'upload'): void {
    const job = this.byKey.get(key);
    if (!job || job.view.status !== 'needs-decision') return;
    if (choice === 'skip') {
      this.set(job, { status: 'skipped' });
    } else {
      job.allowDuplicate = true;
      this.set(job, { status: 'hashed', existing: undefined, duplicateKind: undefined });
    }
    this.schedule();
  }

  snapshot(): EngineSnapshot {
    return {
      files: this.jobs.map((j) => ({ ...j.view })),
      paused: this.paused,
      offline: this.offline,
      linkDown:
        this.failuresInARow.storage >= LINK_DOWN_AFTER || this.failuresInARow.api >= LINK_DOWN_AFTER,
      slots: this.slots,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolves once nothing is running and nothing more can start on its own
   *  (everything terminal, waiting on a decision, or halted). */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ---- scheduling -----------------------------------------------------------

  private get halted(): boolean {
    return this.paused || this.offline;
  }

  private halt(): void {
    this.haltCtrl.abort();
    for (const job of this.jobs) for (const f of job.inflight.values()) this.stopPart(f);
    this.notify();
    this.schedule();
  }

  private unhalt(): void {
    if (this.halted) return;
    this.haltCtrl = new AbortController();
    this.notify();
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    // Hash in order (local CPU — carries on while halted).
    for (const job of this.jobs) {
      if (this.hashing >= this.hashConcurrency) break;
      if (job.view.status === 'queued') void this.hashJob(job);
    }
    if (!this.halted) {
      if (!this.initInFlight) this.maybeInit();
      if (!this.completeInFlight) this.maybeComplete();
      this.fillSlots();
    }
    this.notify();
    if (this.isIdle()) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  private isIdle(): boolean {
    if (this.hashing || this.initInFlight || this.completeInFlight || this.busySlots || this.sleeping) return false;
    if (this.cancelling || this.scheduled) return false;
    for (const job of this.jobs) {
      const s = job.view.status;
      if (s === 'queued' || s === 'hashing' || s === 'cancelling') return false;
      if (this.halted) continue;
      if (s === 'hashed' || s === 'ready' || s === 'uploading' || s === 'completing') return false;
    }
    return true;
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private set(job: Job, patch: Partial<FileView>): void {
    Object.assign(job.view, patch);
  }

  /** Start a new generation: stale callbacks back off, stale sleeps/calls end. */
  private nextGen(job: Job): void {
    job.gen += 1;
    job.wake.abort();
    job.wake = new AbortController();
  }

  /** Forget everything in flight for a job (cancel / retry / re-init / fail). */
  private reset(job: Job): void {
    this.nextGen(job);
    job.hashCtrl?.abort();
    for (const f of job.inflight.values()) this.stopPart(f);
    job.inflight.clear();
    job.pending = [];
    job.cooling.clear();
    job.done.clear();
    job.urls.clear();
    job.partBudgets.clear();
    job.signBudget = newBudget();
    job.resigns.clear();
    job.signing = undefined;
    job.session = undefined;
    job.wantsComplete = false;
    job.parked = false;
    this.set(job, { bytesDone: 0, bytesInFlight: 0, uploadId: undefined, resumed: undefined });
  }

  /** Stop sending a job's parts but keep its session (the server has taken
   *  over — it is completing the file, or being asked to discard it). */
  private detachParts(job: Job): void {
    this.nextGen(job);
    for (const f of job.inflight.values()) this.stopPart(f);
    job.inflight.clear();
    job.pending = [];
    job.cooling.clear();
    job.urls.clear();
    job.signing = undefined;
    job.view.bytesInFlight = 0;
  }

  private stopPart(f: InFlight): void {
    f.reason ??= 'stop';
    f.ctrl.abort();
  }

  /** Stop a file. Its session and confirmed bytes are kept (unless the session
   *  itself is gone), so Retry resumes and Cancel can still discard it. */
  private fail(job: Job, error: string, retryable = true, sessionLost = false): void {
    const sessionId = sessionLost ? undefined : (job.session?.id ?? job.view.uploadId);
    const kept = sessionLost ? 0 : job.view.bytesDone;
    this.reset(job);
    this.set(job, { status: 'failed', error, retryable, uploadId: sessionId, bytesDone: kept });
  }

  /** Sleep that counts as running work (keeps whenIdle honest) and ends early
   *  on halt or when the job's generation moves on. */
  private async backoff(ms: number, job?: Job): Promise<void> {
    this.sleeping += 1;
    const ctrl = new AbortController();
    const unlink = link([this.haltCtrl.signal, job?.wake.signal], () => ctrl.abort());
    try {
      await this.env.sleep(ms, ctrl.signal);
    } finally {
      unlink();
      this.sleeping -= 1;
    }
  }

  /** One API call with a timeout; also aborted on halt (unless `haltable` is
   *  false) and when `job`'s generation moves on. Aborts reject as TransportError(0). */
  private async api<T>(
    call: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    opts: { job?: Job; haltable?: boolean } = {},
  ): Promise<T> {
    const ctrl = new AbortController();
    const unlink = link(
      [opts.haltable === false ? undefined : this.haltCtrl.signal, opts.job?.wake.signal],
      () => ctrl.abort(),
    );
    const timer = new AbortController();
    void this.env.sleep(timeoutMs, timer.signal).then(() => {
      if (!timer.signal.aborted) ctrl.abort();
    });
    try {
      if (ctrl.signal.aborted) throw new TransportError('Stopped', 0);
      const res = await call(ctrl.signal);
      this.succeeded('api');
      return res;
    } catch (e) {
      if (ctrl.signal.aborted && !(e instanceof TransportError)) throw new TransportError('Stopped', 0);
      throw e;
    } finally {
      timer.abort();
      unlink();
    }
  }

  private succeeded(channel: Channel): void {
    this.lastSuccessAt[channel] = this.env.now();
    this.failuresInARow[channel] = 0;
  }

  /**
   * Account one transient failure of a request started at `startedAt`. It only
   * COUNTS toward `max` if another request on the channel got through since —
   * i.e. the link is up and this request itself keeps failing. During an outage
   * nothing counts, and the request retries until `giveUpMs` has passed.
   */
  private charge(budget: Budget, channel: Channel, startedAt: number, max: number): 'retry' | 'give-up' {
    const now = this.env.now();
    budget.tries += 1;
    budget.firstFailureAt ??= now;
    this.failuresInARow[channel] += 1;
    if (this.lastSuccessAt[channel] > startedAt) budget.counted += 1;
    if (budget.counted >= max || now - budget.firstFailureAt >= this.giveUpMs) return 'give-up';
    return 'retry';
  }

  // ---- hash -----------------------------------------------------------------

  private async hashJob(job: Job): Promise<void> {
    const gen = job.gen;
    this.hashing += 1;
    const ctrl = new AbortController();
    job.hashCtrl = ctrl;
    this.set(job, { status: 'hashing', hashedBytes: 0 });
    try {
      const hex = await this.env.hash(
        job.item.source,
        (bytes) => {
          if (job.gen === gen) job.view.hashedBytes = bytes;
          this.notify();
        },
        ctrl.signal,
      );
      if (job.gen !== gen) return;
      job.sha256 = hex;
      this.set(job, { hashedBytes: job.item.source.size });
      const twin = this.jobs.find(
        (j) =>
          j !== job &&
          j.sha256 === hex &&
          j.item.source.size === job.item.source.size &&
          j.item.fileName === job.item.fileName &&
          j.item.folderId === job.item.folderId &&
          !['failed', 'cancelled', 'cancelling', 'skipped'].includes(j.view.status),
      );
      if (twin) {
        // The same file twice in one drop: upload it once (they would share one session).
        this.set(job, {
          status: 'skipped',
          duplicateKind: 'same-drop',
          note: `Same file as ${twin.item.relativePath ?? twin.item.fileName}.`,
        });
      } else {
        this.set(job, { status: 'hashed' });
      }
    } catch (e) {
      if (job.gen !== gen) return;
      this.fail(job, `Could not read this file (${errorMessage(e)}). Is it still on this computer?`, true);
    } finally {
      this.hashing -= 1;
      if (job.hashCtrl === ctrl) job.hashCtrl = undefined;
      this.schedule();
    }
  }

  // ---- init -----------------------------------------------------------------

  private maybeInit(): void {
    const waiting = this.jobs.filter((j) => j.view.status === 'ready').length;
    const room = this.readyAhead - waiting;
    if (room <= 0) return;
    const candidates = this.jobs.filter((j) => j.view.status === 'hashed' && !j.parked);
    const invalid = candidates.filter((j) => !j.item.fileName || j.item.fileName.length > MAX_FILE_NAME);
    for (const j of invalid) this.fail(j, `The file name must be 1–${MAX_FILE_NAME} characters.`, false);
    const valid = candidates.filter((j) => !invalid.includes(j));
    const solo = valid.find((j) => j.soloInit);
    const batch = solo ? [solo] : valid.slice(0, Math.min(room, MAX_INIT_FILES));
    if (batch.length) void this.runInit(batch);
  }

  private async runInit(batch: Job[]): Promise<void> {
    this.initInFlight = true;
    const gens = batch.map((j) => j.gen);
    const live = () => batch.filter((j, i) => j.gen === gens[i] && j.view.status === 'hashed');
    const budget = newBudget();
    try {
      for (;;) {
        const jobs = live();
        if (!jobs.length) return;
        const sentGens = jobs.map((j) => j.gen);
        const startedAt = this.env.now();
        let res: InitResponse;
        try {
          res = await this.api((signal) => this.transport.init(jobs.map((j) => this.initFile(j)), signal), INIT_TIMEOUT_MS);
          if (!res || (res.mode !== 'proxy' && !Array.isArray((res as { results?: unknown }).results))) {
            throw new TransportError('The server sent an unreadable reply.', 0);
          }
        } catch (e) {
          const status = statusOf(e);
          if (classifyApi(status) === 'fatal') {
            if (status === 400 && jobs.length > 1) {
              // One bad file rejects the whole batch: init them one by one so
              // only that file fails.
              for (const j of jobs) j.soloInit = true;
              return;
            }
            for (const j of live()) this.fail(j, errorMessage(e), status === 401);
            return;
          }
          if (this.halted) return; // they stay 'hashed'; resume re-inits them
          if (this.charge(budget, 'api', startedAt, MAX_API_ATTEMPTS) === 'give-up') {
            for (const j of live()) this.fail(j, errorMessage(e), true);
            return;
          }
          await this.backoff(backoffMs(budget.tries, this.env.random));
          if (this.halted) return;
          continue;
        }
        if (res.mode === 'proxy') {
          for (const j of live()) this.set(j, { status: 'fallback' });
          return;
        }
        const current = live();
        const answered = new Set<Job>();
        for (const r of res.results) {
          const job = typeof r?.index === 'number' ? jobs[r.index] : undefined;
          if (!job) continue;
          if (current.includes(job)) {
            if (answered.has(job)) continue; // one answer per file
            answered.add(job);
            job.soloInit = false;
            this.applyInit(job, r);
          } else if (r.status === 'upload' && job.view.status === 'cancelled' && job.gen !== sentGens[r.index]) {
            // Cancelled while its init was in flight: free the session it opened.
            void this.abortSession(r.uploadId);
          }
        }
        // A file the server gave no answer for: ask again later (bounded)
        // rather than re-sending it on every pump.
        for (const j of current) {
          if (!answered.has(j)) void this.followUp(j, () => undefined, 'No answer from the server.');
        }
        return;
      }
    } finally {
      this.initInFlight = false;
      this.schedule();
    }
  }

  private initFile(job: Job): InitUploadFile {
    const { item } = job;
    const lm = item.lastModified;
    const mime = item.mimeType && item.mimeType.length <= MAX_MIME ? item.mimeType : 'application/octet-stream';
    return {
      fileName: item.fileName,
      mimeType: mime,
      sizeBytes: item.source.size,
      ...(lm !== undefined && Number.isSafeInteger(lm) && lm >= 0 && lm <= MAX_LAST_MODIFIED ? { lastModified: lm } : {}),
      ...(item.relativePath && item.relativePath.length <= MAX_RELATIVE_PATH ? { relativePath: item.relativePath } : {}),
      sha256: job.sha256!,
      ...(job.allowDuplicate ? { allowDuplicate: true } : {}),
      folderId: item.folderId,
    };
  }

  private applyInit(job: Job, r: InitResult): void {
    switch (r.status) {
      case 'upload': {
        const session = { id: r.uploadId, partSize: r.partSize, partCount: r.partCount };
        job.session = session;
        job.done = new Set(r.doneParts);
        job.pending = partsToSend(r.partCount, r.doneParts);
        const now = this.env.now();
        const expiresAt = Date.parse(r.urlsExpireAt);
        job.urls.clear();
        for (const part of r.urls ?? []) job.urls.set(part.partNumber, { part, fetchedAt: now, expiresAt });
        this.set(job, {
          status: 'ready',
          uploadId: r.uploadId,
          resumed: r.resumed,
          bytesDone: bytesOf(job.done, r.partSize, job.item.source.size),
          bytesInFlight: 0,
        });
        if (!job.pending.length) this.toComplete(job); // storage already has every part
        return;
      }
      case 'already-uploaded':
        this.set(job, { status: 'skipped', existing: r.existing, duplicateKind: 'already-uploaded' });
        return;
      case 'duplicate':
      case 'possible-duplicate':
        this.set(job, { status: 'needs-decision', existing: r.existing, duplicateKind: r.status });
        return;
      case 'in-progress':
        // Another tab (or the server's sweeper) is finishing this very file.
        job.session = undefined;
        this.toComplete(job, r.uploadId);
        return;
      case 'rejected':
        this.fail(job, r.reason, false);
        return;
      case 'retry':
      default:
        // stays 'hashed'; re-init after the wait
        void this.followUp(job, () => undefined, (r as { reason?: string }).reason ?? 'The server could not start this upload.');
        return;
    }
  }

  /** A server "try again" (or no answer) for one file: back off, then `again()`
   *  — bounded by MAX_FOLLOW_UPS. */
  private async followUp(job: Job, again: () => void, reason: string): Promise<void> {
    const gen = job.gen;
    job.followUps += 1;
    try {
      if (job.followUps > MAX_FOLLOW_UPS) {
        this.fail(job, reason, true);
        return;
      }
      // Parked: init/complete leave it alone while we wait.
      job.parked = true;
      job.wantsComplete = false;
      await this.backoff(backoffMs(Math.min(job.followUps, 5), this.env.random), job);
      if (job.gen !== gen) return;
      job.parked = false;
      again();
    } finally {
      this.schedule(); // on EVERY exit — a reset during the wait must still wake the pump
    }
  }

  /** Start over with a new session (the old one expired or vanished). */
  private reinit(job: Job, why: string): void {
    job.reinits += 1;
    if (job.reinits > MAX_REINITS) {
      this.fail(job, why, true, true);
      return;
    }
    this.reset(job);
    this.set(job, { status: 'hashed' });
  }

  // ---- parts ----------------------------------------------------------------

  private fillSlots(): void {
    while (this.busySlots < this.slots) {
      const next = this.nextPart();
      if (!next) return;
      void this.sendPart(next.job, next.part);
    }
  }

  /** The oldest active file's lowest pending part; activate another file only
   *  when every active one is fully in flight. */
  private nextPart(): { job: Job; part: number } | null {
    let active = 0;
    for (const job of this.jobs) {
      if (job.view.status !== 'uploading') continue;
      active += 1;
      if (job.pending.length && !job.signing) return { job, part: job.pending.shift()! };
    }
    if (active >= this.maxActiveFiles) return null;
    const ready = this.jobs.find((j) => j.view.status === 'ready' && j.pending.length);
    if (!ready) return null;
    this.set(ready, { status: 'uploading' });
    return { job: ready, part: ready.pending.shift()! };
  }

  private async sendPart(job: Job, n: number): Promise<void> {
    const gen = job.gen;
    const session = job.session!;
    this.busySlots += 1;
    const f: InFlight = { ctrl: new AbortController(), loaded: 0, lastProgressAt: this.env.now() };
    job.inflight.set(n, f);
    let startedAt = this.env.now();
    try {
      const url = await this.urlFor(job, n);
      if (job.gen !== gen || !url) return; // signing failed and already handled the job
      if (f.reason) throw new TransportError('stopped', 0); // halted while signing
      const [start, end] = partRange(n, session.partSize, job.item.source.size);
      startedAt = this.env.now();
      await this.putWatched(f, url, job.item.source.slice(start, end), () => {
        if (job.gen === gen) this.refreshInFlight(job);
      });
      if (job.gen !== gen) return;
      this.succeeded('storage');
      job.inflight.delete(n);
      if (!job.done.has(n)) {
        job.done.add(n);
        this.set(job, { bytesDone: job.view.bytesDone + (end - start) });
      }
      job.partBudgets.delete(n);
      job.resigns.delete(n);
      this.refreshInFlight(job);
      this.onSuccess();
      if (!job.pending.length && !job.inflight.size && !job.cooling.size && job.view.status === 'uploading') {
        this.toComplete(job);
      }
    } catch (e) {
      if (job.gen !== gen) return;
      job.inflight.delete(n);
      this.refreshInFlight(job);
      await this.onPartError(job, gen, n, f, e, startedAt);
    } finally {
      this.busySlots -= 1;
      this.schedule();
    }
  }

  private async onPartError(
    job: Job,
    gen: number,
    n: number,
    f: InFlight,
    e: unknown,
    startedAt: number,
  ): Promise<void> {
    if (f.reason === 'stop') {
      // Halted (or reset): put it back unless the job itself was reset.
      if (job.gen === gen && !job.pending.includes(n)) job.pending.unshift(n);
      return;
    }
    const kind = f.reason === 'stall' ? 'transient' : classifyPut(statusOf(e));
    if (kind === 'resign') {
      job.urls.delete(n);
      const r = (job.resigns.get(n) ?? 0) + 1;
      job.resigns.set(n, r);
      if (r > MAX_RESIGNS) {
        this.fail(job, 'Storage keeps refusing this upload (403). Check the computer’s date and time, then retry.');
        return;
      }
      job.pending.unshift(n);
      return;
    }
    if (kind === 'session-gone') {
      this.reinit(job, 'The upload session was lost.');
      return;
    }
    if (kind === 'fatal') {
      this.fail(job, `Storage rejected part ${n} (${statusOf(e)}).`);
      return;
    }
    // Transient: fewer parts at once, back off, then retry this part.
    this.onTrouble();
    let budget = job.partBudgets.get(n);
    if (!budget) job.partBudgets.set(n, (budget = newBudget()));
    if (this.charge(budget, 'storage', startedAt, MAX_PART_ATTEMPTS) === 'give-up') {
      this.fail(job, 'The connection kept dropping. Retry when your internet is stable — finished parts are kept.');
      return;
    }
    job.cooling.add(n);
    await this.backoff(backoffMs(budget.tries, this.env.random), job);
    if (job.gen === gen && job.cooling.delete(n) && !job.pending.includes(n)) job.pending.unshift(n);
  }

  /** PUT with a stall watchdog: no progress for STALL_MS ⇒ abort (retried).
   *  The window starts HERE — time spent signing the URL never counts. */
  private async putWatched(f: InFlight, url: PartUrl, body: unknown, onTick: () => void): Promise<void> {
    f.lastProgressAt = this.env.now();
    f.loaded = 0;
    const stop = new AbortController();
    const watch = (async () => {
      while (!stop.signal.aborted) {
        await this.env.sleep(STALL_CHECK_MS, stop.signal);
        if (stop.signal.aborted) return;
        if (this.env.now() - f.lastProgressAt > STALL_MS) {
          f.reason ??= 'stall';
          f.ctrl.abort();
          return;
        }
      }
    })();
    try {
      await this.transport.put(
        url,
        body,
        (loaded) => {
          if (loaded !== f.loaded) f.lastProgressAt = this.env.now();
          f.loaded = loaded;
          onTick();
        },
        f.ctrl.signal,
      );
      if (f.reason) throw new TransportError('aborted', 0); // resolved despite an abort
    } finally {
      stop.abort();
      await watch;
    }
  }

  private refreshInFlight(job: Job): void {
    let bytes = 0;
    for (const f of job.inflight.values()) bytes += f.loaded;
    job.view.bytesInFlight = bytes;
    this.notify();
  }

  private onSuccess(): void {
    this.successStreak += 1;
    if (this.successStreak >= GROW_AFTER && this.slots < this.maxSlots) {
      this.slots += 1;
      this.successStreak = 0;
    }
  }

  private onTrouble(): void {
    this.successStreak = 0;
    this.slots = Math.max(this.minSlots, Math.floor(this.slots / 2));
  }

  /** A usable presigned URL for part n, signing a batch when needed. Returns
   *  null when signing failed terminally (the job was failed / re-initialised /
   *  handed to the server to complete). */
  private async urlFor(job: Job, n: number): Promise<PartUrl | null> {
    const gen = job.gen;
    for (;;) {
      const cached = job.urls.get(n);
      if (cached && !this.isStale(cached)) return cached.part;
      // Halted: stop here — sendPart's error path puts the part back (its
      // in-flight record was marked 'stop' by halt()).
      if (this.halted) throw new TransportError('halted', 0);
      const own = !job.signing;
      const startedAt = this.env.now();
      if (own) job.signing = this.signBatch(job, n);
      const signing = job.signing!;
      try {
        await signing;
      } catch (e) {
        if (job.gen !== gen) return null;
        if (!own) continue; // another part's batch failed — it handles that; try our own
        const status = statusOf(e);
        if (status === 409) {
          // Not UPLOADING any more — e.g. the sweeper is completing it. Follow it.
          this.detachParts(job);
          this.toComplete(job);
          return null;
        }
        if (status === 404 || status === 410) {
          this.reinit(job, 'The upload session expired.');
          return null;
        }
        if (classifyApi(status) === 'fatal') {
          this.fail(job, errorMessage(e), status === 401);
          return null;
        }
        if (this.halted) throw e;
        this.onTrouble();
        if (this.charge(job.signBudget, 'api', startedAt, MAX_API_ATTEMPTS) === 'give-up') {
          this.fail(job, errorMessage(e), true);
          return null;
        }
        await this.backoff(backoffMs(job.signBudget.tries, this.env.random), job);
        if (job.gen !== gen) return null;
        continue;
      } finally {
        if (job.signing === signing) {
          job.signing = undefined;
          this.schedule(); // parts of this file skipped while it was signing can start now
        }
      }
      if (job.gen !== gen) return null;
      job.signBudget = newBudget();
      const got = job.urls.get(n);
      if (got) return got.part; // just signed — use it even if a skewed clock calls it stale
      if (own) {
        this.fail(job, 'The server did not return an upload link for this file.');
        return null;
      }
    }
  }

  /** Refresh a URL that expires within URL_REFRESH_MS — unless it is brand new
   *  (a client clock hours off would otherwise re-sign before every part). */
  private isStale(u: { fetchedAt: number; expiresAt: number }): boolean {
    const now = this.env.now();
    return u.expiresAt - now < URL_REFRESH_MS && now - u.fetchedAt > URL_MIN_AGE_MS;
  }

  private async signBatch(job: Job, n: number): Promise<void> {
    const session = job.session!;
    const fresh = (p: number) => {
      const u = job.urls.get(p);
      return !!u && !this.isStale(u);
    };
    const want = [n, ...job.pending.filter((p) => p !== n && !fresh(p))].slice(0, MAX_SIGN_PARTS);
    const res = await this.api((signal) => this.transport.signParts(session.id, want, signal), SIGN_TIMEOUT_MS, { job });
    if (!res || !Array.isArray(res.parts)) throw new TransportError('The server sent an unreadable reply.', 0);
    if (job.session !== session) return;
    const now = this.env.now();
    const expiresAt = Date.parse(res.urlsExpireAt);
    for (const part of res.parts) job.urls.set(part.partNumber, { part, fetchedAt: now, expiresAt });
  }

  // ---- complete -------------------------------------------------------------

  private toComplete(job: Job, sessionId?: string): void {
    this.set(job, { status: 'completing', uploadId: sessionId ?? job.session?.id ?? job.view.uploadId });
    job.wantsComplete = true;
    this.schedule();
  }

  private maybeComplete(): void {
    const batch = this.jobs
      .filter((j) => j.view.status === 'completing' && j.wantsComplete && !j.parked)
      .slice(0, MAX_COMPLETE_IDS);
    if (batch.length) void this.runComplete(batch);
  }

  private async runComplete(batch: Job[]): Promise<void> {
    this.completeInFlight = true;
    const gens = batch.map((j) => j.gen);
    for (const j of batch) j.wantsComplete = false;
    const live = () => batch.filter((j, i) => j.gen === gens[i] && j.view.status === 'completing');
    const budget = newBudget();
    try {
      for (;;) {
        const jobs = live();
        if (!jobs.length) return;
        const startedAt = this.env.now();
        let res: CompleteResponse;
        try {
          const ids = [...new Set(jobs.map((j) => j.view.uploadId!))];
          res = await this.api((signal) => this.transport.complete(ids, signal), COMPLETE_TIMEOUT_MS);
          if (!res || !Array.isArray(res.results)) throw new TransportError('The server sent an unreadable reply.', 0);
        } catch (e) {
          const status = statusOf(e);
          if (classifyApi(status) === 'fatal') {
            for (const j of live()) this.fail(j, errorMessage(e), status === 401);
            return;
          }
          if (this.halted) {
            for (const j of live()) j.wantsComplete = true; // re-sent on resume
            return;
          }
          if (this.charge(budget, 'api', startedAt, MAX_API_ATTEMPTS) === 'give-up') {
            for (const j of live()) this.fail(j, errorMessage(e), true);
            return;
          }
          await this.backoff(backoffMs(budget.tries, this.env.random));
          if (this.halted) {
            for (const j of live()) j.wantsComplete = true;
            return;
          }
          continue;
        }
        // Several jobs may share a session id — every one of them gets the answer.
        const byId = new Map<string, Job[]>();
        for (const j of live()) byId.set(j.view.uploadId!, [...(byId.get(j.view.uploadId!) ?? []), j]);
        for (const r of res.results) {
          const group = r && typeof r.id === 'string' ? byId.get(r.id) : undefined;
          if (!group) continue;
          byId.delete(r.id); // one answer per session
          for (const job of group) this.applyComplete(job, r);
        }
        for (const group of byId.values()) {
          for (const j of group) void this.followUp(j, () => (j.wantsComplete = true), 'No answer from the server.');
        }
        return;
      }
    } finally {
      this.completeInFlight = false;
      this.schedule();
    }
  }

  private applyComplete(job: Job, r: CompleteResult): void {
    switch (r.status) {
      case 'completed':
        job.session = undefined;
        this.set(job, {
          status: 'done',
          file: r.file,
          relocated: r.relocated,
          bytesDone: job.item.source.size,
          bytesInFlight: 0,
        });
        return;
      case 'missing-parts': {
        if (job.cancelRequested) {
          // The server let go of it after all (back to UPLOADING): the officer
          // wanted it cancelled, so cancel it now.
          job.cancelRequested = false;
          this.set(job, { note: undefined });
          void this.cancel(job.item.key);
          return;
        }
        const session = job.session;
        job.completeCycles += 1;
        if (!session) {
          this.reinit(job, 'Some parts never reached storage.'); // plan unknown here: init resumes it
          return;
        }
        if (job.completeCycles > MAX_COMPLETE_CYCLES) {
          this.fail(job, 'Some parts never reached storage. Retry to send them again.');
          return;
        }
        for (const p of r.missingParts ?? []) job.done.delete(p);
        job.pending = partsToSend(session.partCount, job.done).filter((p) => !job.inflight.has(p) && !job.cooling.has(p));
        job.urls.clear();
        this.set(job, { status: 'uploading', bytesDone: bytesOf(job.done, session.partSize, job.item.source.size) });
        return;
      }
      case 'in-progress':
        if (job.followUps >= MAX_FOLLOW_UPS) {
          // Uploaded; the server's sweeper will finish recording it on its own.
          job.session = undefined;
          this.set(job, { status: 'handed-off' });
          return;
        }
        void this.followUp(job, () => (job.wantsComplete = true), 'The server is still finishing this file.');
        return;
      case 'expired':
      case 'not-found':
        this.reinit(job, 'The upload session expired.');
        return;
      case 'failed':
        this.fail(job, r.reason, true);
        return;
      case 'retry':
      default:
        void this.followUp(job, () => (job.wantsComplete = true), (r as { reason?: string }).reason ?? 'Please try again.');
        return;
    }
  }

  // ---- cancel ---------------------------------------------------------------

  /** Ask the server to discard a session: 'aborted' (also when it is already
   *  gone), 'finishing' (409 — it is being / has been recorded), or 'unknown'
   *  (no answer after a few tries; the server's sweeper expires it). */
  private async abortSession(id: string): Promise<'aborted' | 'finishing' | 'unknown'> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.api((signal) => this.transport.abort(id, signal), ABORT_TIMEOUT_MS, { haltable: false });
        return 'aborted';
      } catch (e) {
        const status = statusOf(e);
        if (status === 404) return 'aborted';
        if (status === 409) return 'finishing';
        if (classifyApi(status) === 'fatal') return 'unknown';
        if (attempt < 3) await this.backoff(backoffMs(attempt, this.env.random));
      }
    }
    return 'unknown';
  }
}

function statusOf(e: unknown): number {
  if (e instanceof TransportError) return e.status;
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : 0;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
