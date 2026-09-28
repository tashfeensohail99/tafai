/**
 * The databank upload engine (Databank Phase 1 — docs/databank-phase1-resumable-uploads.md §4).
 *
 * Drives many files from "dropped" to "recorded in the databank":
 *   hash (SHA-256, off-thread) → init (batched ≤50) → PUT parts straight to R2
 *   with presigned URLs → complete (batched ≤50)
 * surviving what an office link does to a 20 GB Drive export: dropped
 * connections, stalls, throttling, expired URLs, a tab that resumes days later.
 *
 * Pure orchestration: the network (UploadTransport) and time/hashing
 * (EngineEnv) are injected, so tests drive it with a fake transport that
 * injects 403s, stalls, 5xx and drops and can assert every part lands exactly
 * once. No React, no DOM — the dock subscribes to snapshot().
 *
 * Rules it keeps:
 *  - A part is confirmed only by a 2xx PUT; the SERVER re-verifies every part
 *    (ListParts) before it records the file, so a lie here can't corrupt data.
 *  - Global part slots (adaptive 2–6, AIMD: halve on trouble, +1 after a run of
 *    successes), filled from the OLDEST active file first so files finish in
 *    order; small files run several at a time.
 *  - Nothing is ever re-sent that storage already has (init's doneParts).
 *  - Every retry backs off with jitter; a stalled PUT (no progress for 60 s) is
 *    aborted and retried; an expired URL is re-signed.
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

/** A failed request. `status` is the HTTP status, 0 when there was no response. */
export class TransportError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TransportError';
    this.status = status;
  }
}

export interface UploadTransport {
  init(files: InitUploadFile[]): Promise<InitResponse>;
  signParts(uploadId: string, partNumbers: number[]): Promise<SignPartsResponse>;
  complete(uploadIds: string[]): Promise<CompleteResponse>;
  abort(uploadId: string): Promise<void>;
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
  | 'done' //           recorded in the databank
  | 'skipped' //        already in the databank (identical file, same place)
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
  /** Bytes storage has confirmed (whole parts). */
  bytesDone: number;
  /** Bytes of parts currently in flight (may be discarded on failure). */
  bytesInFlight: number;
  hashedBytes: number;
  uploadId?: string;
  resumed?: boolean;
  relocated?: boolean;
  /** For skipped / needs-decision: the file the databank already holds. */
  existing?: ExistingFile;
  duplicateKind?: 'already-uploaded' | 'duplicate' | 'possible-duplicate';
  /** Failed: why, and whether "Retry" can help. */
  error?: string;
  retryable?: boolean;
  /** Done: the recorded file row. */
  file?: unknown;
}

export interface EngineSnapshot {
  files: FileView[];
  paused: boolean;
  slots: number;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** A PUT with no progress for this long is aborted and retried. */
export const STALL_MS = 60_000;
const STALL_CHECK_MS = 5_000;
/** Attempts per part (transient failures) before the file stops as failed. */
export const MAX_PART_ATTEMPTS = 8;
/** Re-signs of one part in a row before a 403 is treated as final. */
const MAX_RESIGNS = 3;
/** Attempts of one init / complete batch on transient errors. */
const MAX_API_ATTEMPTS = 6;
/** Server-side "retry" / "in-progress" answers to follow per file. */
const MAX_FOLLOW_UPS = 40;
/** Times one file may be re-initialised (session lost / expired). */
const MAX_REINITS = 2;
/** Upload → missing-parts → upload cycles per file. */
const MAX_COMPLETE_CYCLES = 3;
/** Successes in a row before one more part slot is tried. */
const GROW_AFTER = 8;
/** A URL is refreshed when it expires within this, and is not brand new
 *  (the second clause stops a skewed client clock re-signing forever). */
const URL_REFRESH_MS = 120_000;
const URL_MIN_AGE_MS = 60_000;

// ---------------------------------------------------------------------------
// Internal job state
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

interface Job {
  item: UploadItem;
  view: FileView;
  sha256?: string;
  allowDuplicate: boolean;
  /** Bumped whenever the job is reset (cancel, retry, re-init): stale async
   *  callbacks compare their captured generation and back off. */
  gen: number;
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
  attempts: Map<number, number>;
  resigns: Map<number, number>;
  followUps: number;
  reinits: number;
  completeCycles: number;
  /** Queued for the next complete batch. */
  wantsComplete: boolean;
  /** Backing off after a server "try again" — init/complete leave it alone. */
  parked: boolean;
  hashCtrl?: AbortController;
}

const TERMINAL: ReadonlySet<FileStatus> = new Set([
  'done', 'skipped', 'handed-off', 'fallback', 'failed', 'cancelled',
]);

export class UploadEngine {
  private readonly transport: UploadTransport;
  private readonly env: EngineEnv;
  private readonly minSlots: number;
  private readonly maxSlots: number;
  private readonly hashConcurrency: number;
  private readonly maxActiveFiles: number;
  private readonly readyAhead: number;

  private readonly jobs: Job[] = [];
  private readonly byKey = new Map<string, Job>();
  private slots: number;
  private successStreak = 0;
  private paused = false;
  /** Work in flight: hashes, API calls, part slots, back-off sleeps. */
  private hashing = 0;
  private initInFlight = false;
  private completeInFlight = false;
  private busySlots = 0;
  private sleeping = 0;
  /** Aborted on pause, so back-off sleeps end at once. */
  private pauseCtrl = new AbortController();
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
  }

  // ---- public API -----------------------------------------------------------

  /** Queue files. A key already queued is ignored (re-dropping is harmless). */
  add(items: UploadItem[]): void {
    for (const item of items) {
      if (this.byKey.has(item.key)) continue;
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
        pending: [],
        inflight: new Map(),
        cooling: new Set(),
        done: new Set(),
        urls: new Map(),
        attempts: new Map(),
        resigns: new Map(),
        followUps: 0,
        reinits: 0,
        completeCycles: 0,
        wantsComplete: false,
        parked: false,
      };
      this.jobs.push(job);
      this.byKey.set(item.key, job);
    }
    this.schedule();
  }

  /** Stop sending: in-flight parts are aborted (and re-sent on resume). */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.pauseCtrl.abort();
    for (const job of this.jobs) for (const f of job.inflight.values()) this.stopPart(f);
    this.notify();
    this.schedule();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.pauseCtrl = new AbortController();
    this.notify();
    this.schedule();
  }

  /** Cancel one file: stop it and free its server session + stored parts.
   *  A FAILED file can be cancelled too (discarding the parts it kept for a retry). */
  async cancel(key: string): Promise<void> {
    const job = this.byKey.get(key);
    if (!job || (TERMINAL.has(job.view.status) && job.view.status !== 'failed')) return;
    const sessionId = job.session?.id ?? job.view.uploadId;
    this.reset(job);
    this.set(job, { status: 'cancelled' });
    this.schedule();
    if (sessionId) await this.transport.abort(sessionId).catch(() => undefined);
  }

  async cancelAll(): Promise<void> {
    await Promise.all(this.jobs.map((j) => this.cancel(j.item.key)));
  }

  /** Try a failed (or cancelled) file again from the start: a fresh init
   *  resumes whatever storage still holds for it. */
  retry(key: string): void {
    const job = this.byKey.get(key);
    if (!job || (job.view.status !== 'failed' && job.view.status !== 'cancelled')) return;
    this.reset(job);
    job.reinits = 0;
    job.followUps = 0;
    job.completeCycles = 0;
    this.set(job, { status: job.sha256 ? 'hashed' : 'queued', error: undefined, retryable: undefined });
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
      slots: this.slots,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolves once nothing is running and nothing more can start on its own
   *  (everything terminal, waiting on a decision, or paused). */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ---- scheduling -----------------------------------------------------------

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    // Hash in order.
    for (const job of this.jobs) {
      if (this.hashing >= this.hashConcurrency) break;
      if (job.view.status === 'queued') void this.hashJob(job);
    }
    if (!this.paused) {
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
    if (this.scheduled) return false;
    for (const job of this.jobs) {
      const s = job.view.status;
      if (s === 'queued' || s === 'hashing') return false;
      if (this.paused) continue;
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

  /** Forget everything in flight for a job (cancel / retry / re-init). */
  private reset(job: Job): void {
    job.gen += 1;
    job.hashCtrl?.abort();
    for (const f of job.inflight.values()) this.stopPart(f);
    job.inflight.clear();
    job.pending = [];
    job.cooling.clear();
    job.done.clear();
    job.urls.clear();
    job.attempts.clear();
    job.resigns.clear();
    job.signing = undefined;
    job.session = undefined;
    job.wantsComplete = false;
    job.parked = false;
    this.set(job, { bytesDone: 0, bytesInFlight: 0, uploadId: undefined, resumed: undefined });
  }

  /** Stop sending a job's parts but keep its session (the server has taken
   *  over, e.g. it is completing the file): stale part callbacks back off. */
  private detachParts(job: Job): void {
    job.gen += 1;
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

  private fail(job: Job, error: string, retryable = true): void {
    const sessionId = job.session?.id;
    this.reset(job);
    this.set(job, { status: 'failed', error, retryable, uploadId: sessionId });
  }

  /** Sleep that counts as running work (keeps whenIdle honest) and ends early on pause. */
  private async backoff(ms: number): Promise<void> {
    this.sleeping += 1;
    try {
      await this.env.sleep(ms, this.pauseCtrl.signal);
    } finally {
      this.sleeping -= 1;
    }
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
      this.set(job, { status: 'hashed', hashedBytes: job.item.source.size });
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
    const batch = this.jobs
      .filter((j) => j.view.status === 'hashed' && !j.parked)
      .slice(0, Math.min(room, MAX_INIT_FILES));
    if (batch.length) void this.runInit(batch);
  }

  private async runInit(batch: Job[]): Promise<void> {
    this.initInFlight = true;
    const gens = batch.map((j) => j.gen);
    const live = () => batch.filter((j, i) => j.gen === gens[i] && j.view.status === 'hashed');
    try {
      for (let attempt = 1; ; attempt++) {
        const jobs = live();
        if (!jobs.length) return;
        const sentGens = jobs.map((j) => j.gen);
        let res: InitResponse;
        try {
          res = await this.transport.init(jobs.map((j) => this.initFile(j)));
        } catch (e) {
          const status = statusOf(e);
          if (classifyApi(status) === 'fatal' || attempt >= MAX_API_ATTEMPTS) {
            for (const j of live()) this.fail(j, errorMessage(e), classifyApi(status) === 'transient');
            return;
          }
          await this.backoff(backoffMs(attempt, this.env.random));
          if (this.paused) return; // they stay 'hashed'; resume re-inits them
          continue;
        }
        if (res.mode === 'proxy') {
          for (const j of live()) this.set(j, { status: 'fallback' });
          return;
        }
        const current = live();
        const answered = new Set<Job>();
        for (const r of res.results) {
          const job = jobs[r.index];
          if (!job) continue;
          if (current.includes(job)) {
            if (answered.has(job)) continue; // one answer per file
            answered.add(job);
            this.applyInit(job, r);
          } else if (r.status === 'upload' && job.view.status === 'cancelled' && job.gen !== sentGens[r.index]) {
            // Cancelled while its init was in flight: free the session it opened.
            void this.transport.abort(r.uploadId).catch(() => undefined);
          }
        }
        // A file the server gave no answer for: ask again later (bounded) rather
        // than re-sending it on every pump.
        for (const j of current) if (!answered.has(j)) void this.followUp(j, () => undefined, 'No answer from the server.');
        return;
      }
    } finally {
      this.initInFlight = false;
      this.schedule();
    }
  }

  private initFile(job: Job): InitUploadFile {
    const { item } = job;
    return {
      fileName: item.fileName,
      mimeType: item.mimeType || 'application/octet-stream',
      sizeBytes: item.source.size,
      ...(item.lastModified !== undefined ? { lastModified: item.lastModified } : {}),
      ...(item.relativePath ? { relativePath: item.relativePath } : {}),
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
        for (const part of r.urls) job.urls.set(part.partNumber, { part, fetchedAt: now, expiresAt });
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
        this.set(job, { uploadId: r.uploadId });
        job.session = undefined;
        this.toComplete(job, r.uploadId);
        return;
      case 'retry':
        void this.followUp(job, () => undefined, r.reason); // stays 'hashed'; re-init after the wait
        return;
      case 'rejected':
        this.fail(job, r.reason, false);
        return;
    }
  }

  /** A server "try again" for one file: back off, then `again()` — bounded. */
  private async followUp(job: Job, again: () => void, reason: string): Promise<void> {
    const gen = job.gen;
    job.followUps += 1;
    if (job.followUps > MAX_FOLLOW_UPS) {
      this.fail(job, reason, true);
      this.schedule();
      return;
    }
    // Parked: init/complete leave it alone while we wait.
    job.parked = true;
    job.wantsComplete = false;
    await this.backoff(backoffMs(Math.min(job.followUps, 5), this.env.random));
    if (job.gen !== gen) return;
    job.parked = false;
    again();
    this.schedule();
  }

  /** Start over with a new session (the old one expired or vanished). */
  private reinit(job: Job, why: string): void {
    job.reinits += 1;
    if (job.reinits > MAX_REINITS) {
      this.fail(job, why, true);
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
    try {
      const url = await this.urlFor(job, n);
      if (job.gen !== gen) return;
      if (!url) return; // signing failed and already handled the job
      if (f.reason) throw new TransportError('stopped', 0); // paused while signing
      const [start, end] = partRange(n, session.partSize, job.item.source.size);
      await this.putWatched(f, url, job.item.source.slice(start, end), () => {
        if (job.gen === gen) this.refreshInFlight(job);
      });
      if (job.gen !== gen) return;
      job.inflight.delete(n);
      if (!job.done.has(n)) {
        job.done.add(n);
        this.set(job, { bytesDone: job.view.bytesDone + (end - start) });
      }
      job.attempts.delete(n);
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
      await this.onPartError(job, gen, n, f, e);
    } finally {
      this.busySlots -= 1;
      this.schedule();
    }
  }

  private async onPartError(job: Job, gen: number, n: number, f: InFlight, e: unknown): Promise<void> {
    if (f.reason === 'stop') {
      // Paused (or reset): put it back unless the job itself was reset.
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
    const a = (job.attempts.get(n) ?? 0) + 1;
    job.attempts.set(n, a);
    if (a >= MAX_PART_ATTEMPTS) {
      this.fail(job, 'The connection kept dropping. Retry when your internet is stable — finished parts are kept.');
      return;
    }
    job.cooling.add(n);
    await this.backoff(backoffMs(a, this.env.random));
    if (job.gen === gen && job.cooling.delete(n) && !job.pending.includes(n)) job.pending.unshift(n);
  }

  /** PUT with a stall watchdog: no progress for STALL_MS ⇒ abort (retried). */
  private async putWatched(f: InFlight, url: PartUrl, body: unknown, onTick: () => void): Promise<void> {
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
    let ownAttempts = 0;
    for (;;) {
      const cached = job.urls.get(n);
      if (cached && !this.isStale(cached)) return cached.part;
      // Paused: stop here — sendPart's error path puts the part back (its
      // in-flight record was marked 'stop' by pause()).
      if (this.paused) throw new TransportError('paused', 0);
      const own = !job.signing;
      if (own) {
        ownAttempts += 1;
        job.signing = this.signBatch(job, n);
      }
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
        if (classifyApi(status) === 'fatal' || ownAttempts >= MAX_API_ATTEMPTS) {
          this.fail(job, errorMessage(e), classifyApi(status) === 'transient');
          return null;
        }
        this.onTrouble();
        await this.backoff(backoffMs(ownAttempts, this.env.random));
        if (job.gen !== gen) return null;
        continue;
      } finally {
        if (job.signing === signing) {
          job.signing = undefined;
          this.schedule(); // parts of this file skipped while it was signing can start now
        }
      }
      if (job.gen !== gen) return null;
      const got = job.urls.get(n);
      if (got) return got.part; // just signed — use it even if a skewed clock calls it stale
      if (own && ownAttempts >= MAX_API_ATTEMPTS) {
        this.fail(job, 'Could not get an upload link for this file.');
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
    const res = await this.transport.signParts(session.id, want);
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
    try {
      for (let attempt = 1; ; attempt++) {
        const jobs = live();
        if (!jobs.length) return;
        let res: CompleteResponse;
        try {
          res = await this.transport.complete(jobs.map((j) => j.view.uploadId!));
        } catch (e) {
          const status = statusOf(e);
          if (classifyApi(status) === 'fatal' || attempt >= MAX_API_ATTEMPTS) {
            for (const j of live()) this.fail(j, errorMessage(e), classifyApi(status) === 'transient');
            return;
          }
          await this.backoff(backoffMs(attempt, this.env.random));
          if (this.paused) {
            for (const j of live()) j.wantsComplete = true;
            return;
          }
          continue;
        }
        const current = live();
        const byId = new Map(current.map((j) => [j.view.uploadId!, j]));
        for (const r of res.results) {
          const job = byId.get(r.id);
          if (!job) continue;
          byId.delete(r.id); // one answer per file
          this.applyComplete(job, r);
        }
        for (const j of byId.values()) {
          void this.followUp(j, () => (j.wantsComplete = true), 'No answer from the server.');
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
        for (const p of r.missingParts) job.done.delete(p);
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
      case 'retry':
        void this.followUp(job, () => (job.wantsComplete = true), r.reason);
        return;
      case 'expired':
      case 'not-found':
        this.reinit(job, 'The upload session expired.');
        return;
      case 'failed':
        this.fail(job, r.reason, true);
        return;
    }
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
