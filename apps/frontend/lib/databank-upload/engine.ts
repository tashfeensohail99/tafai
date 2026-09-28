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
  /** Optional cheap round trip (GET /health) that proves the link is up. A file
   *  read that fails is only the FILE's fault if the link works — a Drive-
   *  streamed or network-share file is unreadable during an ISP outage too.
   *  Without it, a failed read always counts. */
  ping?(signal: AbortSignal): Promise<unknown>;
}

export interface EngineEnv {
  now(): number;
  /** Resolve after `ms`, or early (never rejecting) when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  random(): number;
  /** Lower-case hex SHA-256 of the whole source (in a Worker in the browser). */
  hash(source: UploadSource, onProgress: (bytes: number) => void, signal: AbortSignal): Promise<string>;
  /** Optional: can bytes [start, end) of the source still be read? A PUT that
   *  fails with no response is probed, so a file that was moved, edited or whose
   *  USB drive was unplugged fails at once instead of looking like an outage. */
  readable?(source: UploadSource, start: number, end: number): Promise<boolean>;
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
  /** Files can't be read and nothing shows the drive / Google Drive works: the
   *  engine waits (one test read at a time) — "Is the drive connected?". */
  readsWaiting: boolean;
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
/** …and only while those failures are recent: once nothing has failed for this
 *  long (the requests that failed have ended, or nothing is being tried), "the
 *  link is down" no longer holds. Longer than the slowest failure cycle (a 60 s
 *  stall + a 30 s back-off, or a 60 s timeout + back-off, in a throttled tab). */
const LINK_DOWN_FRESH_MS = 180_000;
/** A file read (hash) with no progress for this long is abandoned — a stalled
 *  network share must not hold the hash slot forever. Generous: a slow Drive
 *  stream still delivers a slice well within it. */
export const HASH_STALL_MS = 5 * 60_000;
const HASH_CHECK_MS = 30_000;
const PING_TIMEOUT_MS = 20_000;
/** While no file can be read (the drive / NAS / Drive client is away): ONE test
 *  read at a time, this far apart, doubling up to READ_WAIT_MAX_MS. */
export const READ_WAIT_MS = 5_000;
const READ_WAIT_MAX_MS = 60_000;
/** A read that fails, yet reads fine at that spot right after, this many times
 *  in a row, counts anyway (a file that only fails when read in full). */
const READ_OK_BUT_FAILED_MAX = 3;
/** Failed reads are forgiven as link blips for this long while they keep
 *  failing at the same spot — then they count. On a congested uplink (slow
 *  pings, part retries) every read looks like a blip, and a bad file must not
 *  be re-read forever; a flapping link (however often it flaps) gets this long
 *  to let one read through. Blips back off (1 s … 30 s), so a bad file is
 *  re-read a few dozen times at most. */
const BLIP_WINDOW_MS = 30 * 60_000;
/** Bytes up to this far past what was already read may come from a cache
 *  (Drive for desktop serves recently read files while it is offline; the OS
 *  reads ahead): only a read beyond that proves the source works. */
const FRESH_MARGIN = 16 * 1024 * 1024;
/** Nothing left to test the source with (a one-file drop, or every other file
 *  read already): a file that can't be read waits this long (active time), then
 *  fails — it may have been moved or edited, which the browser reports exactly
 *  like an unplugged drive. */
export const NO_PROOF_GIVE_UP_MS = 30 * 60_000;
/** A fresh read this recent before a failure still vouches for the source (a
 *  folder of gone files must not use up one never-read file per check) — but
 *  never twice for one file: each further strike needs a proof newer than that
 *  file's previous failure, so a source that vanishes right after a proof costs
 *  at most one wrong strike, never a failed file. */
const SOURCE_PROOF_HOLD_MS = 15_000;
/** Paused: a read that failed waits for Resume. This many failing in a row
 *  (the drive / Drive client is away) stop the paused hash lane until Resume
 *  or a good read — a paused 20k-file drop must not read every file in turn. */
const HALTED_READ_FAILS_MAX = 3;
const PROBE_TIMEOUT_MS = 30_000;
/** A back-off that wakes this much later than asked means the machine slept
 *  (or the tab was frozen): that time is not "trying" and never counts toward
 *  the give-up window. (Hidden tabs throttle timers to ~1/min, hence the margin.) */
const ASLEEP_MS = 90_000;
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
  /** A Cancel that never got an answer: the row is 'failed', but "Retry failed"
   *  must not resume a file the officer asked to discard. */
  cancelUnconfirmed: boolean;
  /** Dropped again while its Cancel was still being retried — applied once the
   *  Cancel settles. */
  redrop?: UploadItem;
  /** Part → when a probe first found the file unreadable. Only a request that
   *  gets through AFTER that proves the link, and so the file, is the problem. */
  unreadableSince: Map<number, number>;
  /** Reads that failed while online (the file may be gone — or streamed from
   *  a network drive): a few are retried before the file fails. */
  hashFailures: number;
  /** Reads that failed although the same spot read fine right after. */
  readOkButFailed: number;
  /** Failed reads forgiven as blips in a row (see BLIP_WINDOW_MS). */
  blips: number;
  blipsSince?: number;
  /** Where its last failed read stopped: a bad spot fails in the same place
   *  every time; a flapping link breaks reads all over the file. */
  lastFailSpot?: number;
  /** How far this file was READ (hash, probe): reading it again up to here
   *  (+ FRESH_MARGIN) may be served from a cache — no proof of the source. */
  readTo: number;
  /** A read of it failed (and no fresh read since): a poor file to test the source with. */
  readFailed: boolean;
  /** When its previous read failed (see SOURCE_PROOF_HOLD_MS). */
  lastFailedReadAt?: number;
  /** Active time since nothing could tell whether IT or its source is at fault
   *  (see NO_PROOF_GIVE_UP_MS) — this file's own clock. */
  unprovenSince?: number;
  hashCtrl?: AbortController;
}

const TERMINAL: ReadonlySet<FileStatus> = new Set([
  'done', 'skipped', 'handed-off', 'fallback', 'failed', 'cancelled',
]);
/** Statuses with work still to do (see hasWork). */
const WORKING: ReadonlySet<FileStatus> = new Set([
  'queued', 'hashing', 'hashed', 'ready', 'uploading', 'completing', 'cancelling',
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
  /** The ACTIVE clock (see activeNow): time halted or asleep is excluded, so a
   *  pause, an offline night or a closed lid never burns the give-up window. */
  private haltedSince: number | null = null;
  private excludedMs = 0;
  private excludedUntil = -Infinity;
  /** Only the time the machine SLEPT (see awakeNow) — not paused time. */
  private sleptMs = 0;
  private sleptUntil = -Infinity;
  /** Aborted (and replaced) whenever the engine runs again after a halt. */
  private resumeCtrl = new AbortController();
  /** Reads that failed in a row while halted (see HALTED_READ_FAILS_MAX). */
  private haltedReadFails = 0;
  /** Due times of the engine's armed timers (see nap/observe): a timer that
   *  fires far LATER than it was due means the machine slept or the tab froze.
   *  A long timer firing on schedule (a 120 s request timeout) is not sleep. */
  private readonly armed = new Map<object, number>();
  /** Monotonic clock (see now()): a PC clock set BACK never runs time backwards. */
  private lastRawNow = -Infinity;
  private clockSkew = 0;
  /** Per channel: when a request last got through, and failures in a row since. */
  private readonly lastSuccessAt: Record<Channel, number> = { storage: -Infinity, api: -Infinity };
  private readonly failuresInARow: Record<Channel, number> = { storage: 0, api: 0 };
  private readonly lastFailureAt: Record<Channel, number> = { storage: -Infinity, api: -Infinity };
  /** The SOURCE (the drive / NAS / Drive client the files come from): when a
   *  file was last read successfully (a hash slice, a probe, a PUT that sent
   *  bytes), and which one — a sibling to test when a read fails. */
  /** When the link last showed trouble (a request failed, a ping failed or
   *  hung): a read that failed after that may have been a blip, not the file. */
  private lastLinkTroubleAt = -Infinity;
  /** When a read wait (the source away) last ended. */
  private readWaitEndedAt = -Infinity;
  private lastRead: { job: Job; at: number } | null = null;
  /** The most recent read of a DIFFERENT file than lastRead's. */
  private lastOtherRead: { job: Job; at: number } | null = null;
  /** Reads fail and nothing proves the link / the source works: hashing is
   *  gated to one test read at a time (rotating over the files), spaced out.
   *  `wake` ends every read-wait sleep the moment any read succeeds. */
  private readWait: {
    cause: 'link' | 'source';
    streak: number;
    nextAt: number;
    /** The due time a wake-up timer is armed for (one per due time). */
    armedFor?: number;
    sinceActive: number;
    tried: Set<Job>;
    /** Folders of recent test reads: the next one comes from another folder. */
    triedFolders: Set<string | null>;
    wake: AbortController;
  } | null = null;
  /** A timer that tells listeners when a stale "link down" stops holding. */
  private linkExpiryArmed = false;
  /** The one ping in flight (see linkProvenSince). */
  private pinging?: Promise<void>;
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

  /** Queue files. Re-dropping a file already in progress is harmless. Re-dropping
   *  a failed / cancelled one retries it, and a done / skipped one asks the server
   *  again (it may have been deleted since) — both with the NEW drop's File and
   *  destination, since the old handle may be stale and the target may differ. */
  add(items: UploadItem[]): void {
    for (const item of items) {
      const known = this.byKey.get(item.key);
      if (known) {
        const st = known.view.status;
        if (st === 'cancelling') {
          known.redrop = item; // the officer changed their mind: upload it once the Cancel settles
        } else if (st === 'failed' || st === 'cancelled' || st === 'fallback') {
          // (fallback: the server said 'proxy' — dropped again, ask it again. An
          // earlier "Upload anyway" does not carry over: the standard upload may
          // have saved it since, and only the server's duplicate check knows.)
          if (st === 'fallback') known.allowDuplicate = false;
          this.replaceItem(known, item);
          known.cancelUnconfirmed = false; // dropping it again IS the officer's answer
          this.retry(item.key);
        } else if (st === 'done' || st === 'skipped' || st === 'handed-off') {
          this.replaceItem(known, item);
          const twin = this.liveTwin(known);
          if (twin) {
            // A copy of this very file is uploading right now — let it finish.
            this.set(known, {
              status: 'skipped',
              duplicateKind: 'same-drop',
              note: `Same file as ${twin.item.relativePath ?? twin.item.fileName}.`,
            });
            continue;
          }
          this.reset(known);
          known.reinits = 0;
          known.followUps = 0;
          known.completeCycles = 0;
          known.allowDuplicate = false;
          known.soloInit = false;
          known.cancelRequested = false;
          known.cancelUnconfirmed = false;
          known.hashFailures = 0;
          known.blips = 0;
          known.blipsSince = undefined;
          this.set(known, {
            status: known.sha256 ? 'hashed' : 'queued',
            existing: undefined,
            duplicateKind: undefined,
            note: undefined,
            file: undefined,
            relocated: undefined,
            error: undefined,
            retryable: undefined,
          });
        }
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
        cancelUnconfirmed: false,
        unreadableSince: new Map(),
        hashFailures: 0,
        readOkButFailed: 0,
        blips: 0,
        readTo: 0,
        readFailed: false,
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
    if (this.offline) this.halt();
    else this.unhalt();
  }

  /**
   * Cancel one file (also a FAILED one, discarding the parts it kept for a
   * retry): stop sending, then ask the server to discard the session. If the
   * server is already recording the file (409), the row follows it to "done"
   * with a note instead of pretending it was cancelled.
   */
  async cancel(key: string, opts: { keepSession?: boolean } = {}): Promise<void> {
    const job = this.byKey.get(key);
    if (!job) return;
    const s = job.view.status;
    if (s === 'cancelling' || (TERMINAL.has(s) && s !== 'failed')) return;
    if (opts.keepSession) {
      // Stop this row here only. The server session stays (another copy may be
      // uploading on it; else it expires on its own — or resumes on a re-drop).
      this.reset(job);
      this.set(job, { status: 'cancelled' });
      this.schedule();
      return;
    }
    const sessionId = job.session?.id ?? job.view.uploadId;
    // No session — or another live row (a re-dropped copy) is using this very
    // session: cancel THIS row only; discarding the session would kill the other.
    if (!sessionId || this.sessionUsedByOther(job, sessionId)) {
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
      const outcome = await this.abortSession(sessionId, job);
      if (job.gen !== gen) return;
      if (outcome === 'finishing') {
        job.redrop = undefined; // it is being saved anyway
        job.cancelRequested = true;
        this.set(job, {
          note: 'It was already being saved, so it could not be cancelled — delete it from the folder if unwanted.',
        });
        this.toComplete(job, sessionId);
        return;
      }
      if (outcome === 'gave-up') {
        // No answer for the whole give-up window: we do NOT know it was
        // discarded (the server may still record it) — say so, keep the session.
        this.fail(job, 'Could not reach the server to cancel this upload — it may still be saved. Try Cancel again later.', true);
        job.cancelUnconfirmed = true;
      } else {
        this.reset(job);
        this.set(job, { status: 'cancelled' });
      }
      const again = job.redrop;
      job.redrop = undefined;
      if (again) this.add([again]); // dropped again while cancelling: upload it after all
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
    const st = job?.view.status;
    if (!job || (st !== 'failed' && st !== 'cancelled' && st !== 'fallback')) return;
    const twin = this.liveTwin(job);
    if (twin) {
      // A re-dropped copy of the same file is already uploading (and owns the
      // session): let it finish rather than racing it on the same session.
      this.reset(job);
      this.set(job, {
        status: 'skipped',
        duplicateKind: 'same-drop',
        note: `Same file as ${twin.item.relativePath ?? twin.item.fileName}.`,
        error: undefined,
        retryable: undefined,
      });
      this.schedule();
      return;
    }
    this.reset(job);
    job.reinits = 0;
    job.followUps = 0;
    job.completeCycles = 0;
    job.soloInit = false;
    job.cancelRequested = false;
    job.cancelUnconfirmed = false;
    job.hashFailures = 0;
    job.readOkButFailed = 0;
    job.blips = 0;
    job.blipsSince = undefined;
    this.set(job, {
      status: job.sha256 ? 'hashed' : 'queued',
      error: undefined,
      retryable: undefined,
      note: undefined,
    });
    this.schedule();
  }

  /** Retry every failed file — except ones whose Cancel went unanswered (the
   *  officer wanted those gone; an explicit Retry on the row still works). */
  retryFailed(): void {
    for (const j of this.jobs) {
      if (j.view.status === 'failed' && j.view.retryable !== false && !j.cancelUnconfirmed) this.retry(j.item.key);
    }
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
      // (a read wait whose ping failed: no internet — say so; paused, nothing was asked)
      linkDown: this.linkLooksDown() || (this.readWait?.cause === 'link' && !this.halted),
      readsWaiting: this.readWait?.cause === 'source',
      slots: this.slots,
    };
  }

  /** One file's view (a copy); undefined when the key is not in this engine. */
  file(key: string): FileView | undefined {
    const job = this.byKey.get(key);
    return job ? { ...job.view } : undefined;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Anything still to do (hash, init, upload, complete, cancel)? Unlike
   *  snapshot(), copies nothing — the queue asks this a lot on 20k-file drops. */
  hasWork(): boolean {
    for (const j of this.jobs) if (WORKING.has(j.view.status)) return true;
    return false;
  }

  /** One file's status; undefined when the key is not in this engine. */
  status(key: string): FileStatus | undefined {
    return this.byKey.get(key)?.view.status;
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
    this.observe();
    if (this.haltedSince === null) this.haltedSince = this.now();
    this.haltCtrl.abort();
    for (const job of this.jobs) for (const f of job.inflight.values()) this.stopPart(f);
    this.notify();
    this.schedule();
  }

  private unhalt(): void {
    if (this.halted) {
      // Still halted by the OTHER reason (paused + offline): the view changed
      // anyway, and hashing — gated only on offline — may be able to run now.
      this.notify();
      this.schedule();
      return;
    }
    if (this.haltedSince !== null) {
      this.exclude(this.haltedSince, this.now());
      this.haltedSince = null;
    }
    this.failuresInARow.storage = 0;
    this.failuresInARow.api = 0;
    this.haltCtrl = new AbortController();
    this.resumeCtrl.abort(); // reads parked while halted go again now
    this.resumeCtrl = new AbortController();
    this.haltedReadFails = 0;
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
    // Every file that waited on the source was read, cancelled, failed or
    // finished: the wait is over (never a stale "is the drive connected?").
    if (this.readWait && !this.readWaitHasWaiters()) this.endReadWait();
    // Hash in order. Local work, so it carries on while PAUSED — but not while
    // OFFLINE: a file streamed from a network drive can't be read then, and a
    // whole drop must not fail in a burst. (Nor while paused once reads keep
    // failing: the source is away — nothing is judged until Resume anyway.)
    if (!this.offline && !(this.halted && this.haltedReadFails >= HALTED_READ_FAILS_MAX)) {
      if (this.readWait) {
        this.pumpReadWait();
      } else {
        for (const job of this.jobs) {
          if (this.hashing >= this.hashConcurrency) break;
          if (job.view.status === 'queued' && !job.parked) void this.hashJob(job);
        }
      }
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
      // (Queued files wait for the connection while offline — nothing can run.)
      if ((s === 'queued' && !this.offline) || s === 'hashing' || s === 'cancelling') return false;
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

  /** Take the NEW drop's File and destination for a re-dropped key. Size or
   *  lastModified changed ⇒ the content may have too: hash it again. */
  private replaceItem(job: Job, item: UploadItem): void {
    const old = job.item;
    const changed = item.source.size !== old.source.size || item.lastModified !== old.lastModified;
    if (changed) {
      job.sha256 = undefined;
      job.readTo = 0; // different content: nothing read from it yet
      job.readFailed = false;
    }
    job.item = item;
    this.set(job, { fileName: item.fileName, relativePath: item.relativePath, size: item.source.size });
  }

  /** Same destination, name, size and content as another row that is still
   *  in progress (or awaiting a duplicate decision). */
  private liveTwin(job: Job): Job | undefined {
    if (!job.sha256) return undefined;
    return this.jobs.find(
      (j) =>
        j !== job &&
        j.sha256 === job.sha256 &&
        j.item.source.size === job.item.source.size &&
        j.item.fileName === job.item.fileName &&
        j.item.folderId === job.item.folderId &&
        !TERMINAL.has(j.view.status) &&
        j.view.status !== 'cancelling',
    );
  }

  /** Another row that is not finished still points at this server session. */
  private sessionUsedByOther(job: Job, sessionId: string): boolean {
    return this.jobs.some(
      (j) => j !== job && !TERMINAL.has(j.view.status) && (j.session?.id ?? j.view.uploadId) === sessionId,
    );
  }

  /** Session X now belongs to `owner`: failed rows still holding X let go of it
   *  (their Retry / Cancel must not touch the live upload). */
  private claimSession(owner: Job, sessionId: string): void {
    for (const j of this.jobs) {
      if (j === owner || j.view.status !== 'failed' || j.view.uploadId !== sessionId) continue;
      this.set(j, { uploadId: undefined, bytesDone: 0, note: 'Continued by another copy of this file.' });
    }
  }

  /** Engine time that excludes halted and asleep periods. */
  private activeNow(): number {
    const now = this.now();
    return now - this.excludedMs - (this.haltedSince !== null ? now - this.haltedSince : 0);
  }

  /** Engine time that excludes only detected SLEEP (a closed lid, a frozen
   *  tab) — paused time still passes (the hash watchdog runs while paused). */
  private awakeNow(): number {
    return this.now() - this.sleptMs;
  }

  /** Exclude [from, to) from the active clock, never counting any stretch twice. */
  private exclude(from: number, to: number): void {
    const start = Math.max(from, this.excludedUntil);
    if (to > start) this.excludedMs += to - start;
    this.excludedUntil = Math.max(this.excludedUntil, to);
  }

  /** Engine time: the injected clock made monotonic — if the PC clock is set
   *  BACK, later readings carry on from where time was (forward jumps look like
   *  sleep and are handled by observe()). */
  private now(): number {
    const raw = this.env.now();
    if (raw + this.clockSkew < this.lastRawNow + this.clockSkew) this.clockSkew += this.lastRawNow - raw;
    this.lastRawNow = raw;
    return raw + this.clockSkew;
  }

  /** Any armed timer more than ASLEEP_MS overdue ⇒ the machine slept (or the
   *  tab was frozen) from its due time until now: not trying time, so it is
   *  excluded from the give-up window. Called on every timer wake, every charge
   *  and halt. While halted the ACTIVE clock excludes nothing here — unhalt()
   *  excludes the whole halted stretch itself (no double counting) — but the
   *  sleep still counts as sleep for the awake clock (the hash watchdog). */
  private observe(): void {
    const now = this.now();
    let earliest = Infinity;
    for (const due of this.armed.values()) if (due < earliest) earliest = due;
    if (now - earliest > ASLEEP_MS) {
      if (this.haltedSince === null) this.exclude(earliest, now);
      const start = Math.max(earliest, this.sleptUntil);
      if (now > start) this.sleptMs += now - start;
      this.sleptUntil = Math.max(this.sleptUntil, now);
    }
  }

  /** env.sleep that registers its due time (see observe) — every engine timer uses it. */
  private async nap(ms: number, signal?: AbortSignal): Promise<void> {
    const token = {};
    const due = this.now() + ms;
    this.armed.set(token, due);
    try {
      await this.env.sleep(ms, signal);
    } finally {
      this.observe(); // still armed: an overdue wake is caught here
      this.armed.delete(token);
    }
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
    job.unreadableSince.clear();
    job.unprovenSince = undefined;
    job.lastFailedReadAt = undefined;
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
    job.unreadableSince.clear();
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
  private async backoff(ms: number, job?: Job, haltable = true): Promise<void> {
    this.sleeping += 1;
    const ctrl = new AbortController();
    const unlink = link([haltable ? this.haltCtrl.signal : undefined, job?.wake.signal], () => ctrl.abort());
    try {
      await this.nap(ms, ctrl.signal);
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
    void this.nap(timeoutMs, timer.signal).then(() => {
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

  /** Several requests in a row got no answer, nothing got through, and the
   *  latest failure is recent. (A count left behind by requests that ended some
   *  other way — the file failed, was cancelled — must not keep "waiting for the
   *  network" up for good.) */
  private linkLooksDown(): boolean {
    const now = this.now();
    const down = (ch: Channel) =>
      this.failuresInARow[ch] >= LINK_DOWN_AFTER && now - this.lastFailureAt[ch] <= LINK_DOWN_FRESH_MS;
    // PUTs failing while our API answers after them is not "no internet": the
    // bodies can't be read (a NAS / drive away) — the dock asks about the drive.
    const storageDown = down('storage') && !(this.lastSuccessAt.api > this.lastFailureAt.storage);
    return storageDown || down('api');
  }

  /** Nothing else notifies when a "link down" verdict goes stale: a timer does. */
  private armLinkExpiry(): void {
    if (this.linkExpiryArmed) return;
    const last = Math.max(this.lastFailureAt.storage, this.lastFailureAt.api);
    this.linkExpiryArmed = true;
    void this.env.sleep(Math.max(1_000, last + LINK_DOWN_FRESH_MS + 1_000 - this.now())).then(() => {
      this.linkExpiryArmed = false;
      // A newer failure since: wait for ITS expiry (a pure time check — never a tight loop).
      if (this.now() - Math.max(this.lastFailureAt.storage, this.lastFailureAt.api) <= LINK_DOWN_FRESH_MS) this.armLinkExpiry();
      else this.notify();
    });
  }

  /** Did a request get through AFTER `t`? If none has, ask (one cheap ping,
   *  shared). Halted — send nothing: no proof. No ping available: assume yes. */
  private async linkProvenSince(t: number): Promise<boolean> {
    const proven = () => this.lastSuccessAt.api > t || this.lastSuccessAt.storage > t;
    if (proven()) return true;
    if (!this.transport.ping) return true;
    if (this.halted) return false;
    const pingStart = this.now();
    this.pinging ??= this.api((signal) => this.transport.ping!(signal), PING_TIMEOUT_MS)
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        this.pinging = undefined;
      });
    await this.pinging;
    // A ping that failed, or only answered after a while: the link was down.
    if (!proven() || this.now() - pingStart > 3_000) this.lastLinkTroubleAt = this.now();
    return proven();
  }

  /** Where reading `job` would be FRESH: past what was read already (+ margin
   *  for a cache / read-ahead). 0 for a file never read. */
  private freshFrom(job: Job): number {
    return job.readTo > 0 ? job.readTo + FRESH_MARGIN : 0;
  }

  /** `job` read fine up to `to`, where reading from `freshAt` on proves the
   *  source (see freshFrom, taken BEFORE the read). A fresh read ends a read
   *  wait; a read that may have come from a cache only moves readTo. */
  private noteRead(job: Job, to: number, freshAt: number): void {
    if (to > job.readTo) job.readTo = to;
    if (to <= freshAt) return;
    job.readFailed = false;
    const at = this.now();
    if (this.lastRead && this.lastRead.job !== job) this.lastOtherRead = this.lastRead;
    this.lastRead = { job, at };
    if (this.readWait) {
      this.readWaitEndedAt = at;
      this.endReadWait(); // every file waiting on the source goes again now
      this.schedule();
    }
  }

  private endReadWait(): void {
    if (!this.readWait) return;
    this.readWait.wake.abort();
    this.readWait = null;
    this.notify();
  }

  /** Does the SOURCE (the drive / NAS / Drive client) work, AFTER `t`? 'up':
   *  another file was freshly read since, or a 1-byte test of another file at a
   *  spot never read reads fine; 'away': that test fails; 'unknown': nothing
   *  left to test with. Only fresh reads count — bytes read before may come
   *  from Drive for desktop's cache while it is offline. Only ANOTHER file
   *  counts (this file's own reads say nothing about "gone" vs "unplugged").
   *  Without a read probe we can't tell — assume it works (as before). */
  private async sourceState(t: number, job: Job, proofFrom = t): Promise<'up' | 'away' | 'unknown'> {
    if (!this.env.readable) return 'up';
    const other = this.lastRead && this.lastRead.job !== job ? this.lastRead : this.lastOtherRead;
    if (other && other.job !== job && other.at > proofFrom) return 'up';
    // A spot never read, of another file — from ANOTHER folder when there is
    // one (a moved or renamed folder takes its siblings with it): if it reads,
    // the source works. If it doesn't, that proves nothing (it may be gone too).
    const fresh = this.freshTestFile(job);
    if (fresh) {
      const at = this.freshFrom(fresh);
      if ((await this.probe(fresh, at, at + 1)) === 'ok') return 'up';
    }
    // A file that read fine before and can't be read NOW: the drive / NAS / Drive
    // client is away (a cache can make a read succeed, never fail). Two such
    // files, if there are two, so one deleted file can't claim the whole drive.
    const known = this.knownGoodFiles(job);
    if (!known.length) return 'unknown';
    for (const k of known) {
      if ((await this.probe(k, 0, 1)) === 'ok') return 'unknown'; // (reads fine — maybe from a cache)
    }
    return 'away';
  }

  /** Another live file with a spot never read (see freshFrom), whose own read
   *  never failed — preferring a different folder than `job`'s. */
  private freshTestFile(job: Job): Job | undefined {
    let sameFolder: Job | undefined;
    for (const j of this.jobs) {
      if (j === job || j.readFailed || TERMINAL.has(j.view.status) || j.view.status === 'cancelling') continue;
      if (this.freshFrom(j) >= j.item.source.size) continue;
      if ((j.item.folderId ?? null) !== (job.item.folderId ?? null)) return j;
      sameFolder ??= j;
    }
    return sameFolder;
  }

  /** Up to two other files that were read fine before — from different folders
   *  when possible, ones not failing since first. (One that failed only while
   *  the source was away still counts: its failing again is the evidence.) */
  private knownGoodFiles(job: Job): Job[] {
    const ok = (j: Job) => j !== job && j.readTo > 0 && j.item.source.size > 0 && j.view.status !== 'cancelled' && j.view.status !== 'cancelling';
    const pool = this.jobs.filter((j) => ok(j) && !j.readFailed);
    for (const j of this.jobs) if (ok(j) && j.readFailed && pool.length < 2) pool.push(j);
    const first = pool[0];
    if (!first) return [];
    const other = pool.find((j) => j !== first && (j.item.folderId ?? null) !== (first.item.folderId ?? null)) ?? pool.find((j) => j !== first);
    return other ? [first, other] : [first];
  }

  /** Nothing can be read right now (and nothing proves the source works):
   *  gate hashing to one test read at a time — a 20k-file drop must not spin. */
  private enterReadWait(cause: 'link' | 'source', testRead = true): void {
    const w = this.readWait;
    if (w) {
      // Only a failed TEST read spaces out the next one — a part checking its
      // mark joins the wait without postponing the hash lane's test reads.
      if (testRead) {
        w.streak += 1;
        w.nextAt = this.now() + this.readWaitDelay();
      }
      if (w.cause !== cause) {
        w.cause = cause;
        this.notify();
      }
      this.armReadWait();
      return;
    }
    this.readWait = {
      cause,
      streak: 1,
      nextAt: this.now() + READ_WAIT_MS,
      sinceActive: this.activeNow(),
      tried: new Set(),
      triedFolders: new Set(),
      wake: new AbortController(),
    };
    this.notify();
    this.armReadWait();
  }

  /** Is any file still held by the read wait — a read to try (again), or a
   *  part marked unreadable? */
  private readWaitHasWaiters(): boolean {
    for (const j of this.jobs) {
      const s = j.view.status;
      if (s === 'queued' || s === 'hashing') return true;
      if (j.unreadableSince.size && !TERMINAL.has(s) && s !== 'cancelling') return true;
    }
    return false;
  }

  /** Sleep (not "work": the engine is halted) until it runs again or the job
   *  moves on. (A day at most — then it is simply read once more.) */
  private async waitForResume(job: Job): Promise<void> {
    const ctrl = new AbortController();
    const unlink = link([job.wake.signal, this.resumeCtrl.signal], () => ctrl.abort());
    try {
      await this.nap(24 * 3600_000, ctrl.signal);
    } finally {
      unlink();
    }
  }

  /** Sleep that counts as work, ended early when the job resets or any file
   *  reads again (the source is back). */
  private async waitForSource(job: Job, ms: number): Promise<void> {
    this.sleeping += 1;
    const ctrl = new AbortController();
    const unlink = link([job.wake.signal, this.readWait?.wake.signal], () => ctrl.abort());
    try {
      await this.nap(ms, ctrl.signal);
    } finally {
      unlink();
      this.sleeping -= 1;
    }
  }

  private readWaitDelay(): number {
    const streak = this.readWait?.streak ?? 1;
    const base = Math.min(READ_WAIT_MAX_MS, READ_WAIT_MS * 2 ** Math.min(10, streak - 1));
    return Math.round(base * (0.75 + this.env.random() * 0.5));
  }

  /** Wake the pump when the next test read is due — every time nextAt moves
   *  (one timer per due time): a wait with no timer armed never tries again. */
  private armReadWait(): void {
    const w = this.readWait;
    if (!w || w.armedFor === w.nextAt) return;
    const due = (w.armedFor = w.nextAt);
    void this.nap(Math.max(0, due - this.now()), w.wake.signal).then(() => {
      if (w.armedFor === due) w.armedFor = undefined;
      if (this.readWait === w) this.schedule();
    });
  }

  /** In a read wait: start ONE test read when it is due, rotating over the
   *  queued files (a file that is really gone can't block the others). */
  private pumpReadWait(): void {
    const w = this.readWait!;
    if (this.hashing > 0) return; // (its end schedules the pump)
    if (this.now() < w.nextAt) {
      this.armReadWait();
      return;
    }
    const queued = this.jobs.filter((j) => j.view.status === 'queued' && !j.parked);
    if (!queued.length) return;
    // Rotate over the files — and over their FOLDERS: a moved or renamed folder
    // must not be walked through file by file before anything else is tried.
    const folderOf = (j: Job) => j.item.folderId ?? null;
    let untried = queued.filter((j) => !w.tried.has(j));
    if (!untried.length) {
      w.tried.clear();
      untried = queued;
    }
    let next = untried.find((j) => !w.triedFolders.has(folderOf(j)));
    if (!next) {
      w.triedFolders.clear();
      next = untried[0];
    }
    w.tried.add(next);
    w.triedFolders.add(folderOf(next));
    w.nextAt = this.now() + this.readWaitDelay();
    this.armReadWait();
    void this.hashJob(next);
  }

  /** The source has been away for giveUpMs (the active clock, like every other wait). */
  private sourceGaveUp(): boolean {
    const w = this.readWait;
    return !!w && this.activeNow() - w.sinceActive >= this.giveUpMs;
  }

  /** Nothing could tell for NO_PROOF_GIVE_UP_MS whether THIS file or its source
   *  is at fault (a one-file drop, or everything else read already). */
  private unprovenTooLong(job: Job): boolean {
    return job.unprovenSince !== undefined && this.activeNow() - job.unprovenSince >= NO_PROOF_GIVE_UP_MS;
  }

  /** Give up on reading `job`. The source away for hours: every file still
   *  queued behind the one test read at a time fails too (not one per test
   *  read — a 20k-file drop would take weeks). Only this file's own clock ran
   *  out: only this file. Parts marked unreadable fail on their next check. */
  private giveUpReads(job: Job, e: unknown): void {
    if (this.sourceGaveUp()) {
      const msg = `Could not read this file for hours (${errorMessage(e)}). Is the drive / Google Drive connected?`;
      this.fail(job, msg, true);
      for (const j of this.jobs) if (j !== job && j.view.status === 'queued') this.fail(j, msg, true);
      return;
    }
    this.fail(job, `Could not read this file (${errorMessage(e)}) — was it moved, edited or renamed, or its drive disconnected? Drop it again to continue.`, true);
  }

  private succeeded(channel: Channel): void {
    this.lastSuccessAt[channel] = this.now();
    this.failuresInARow[channel] = 0;
  }

  /**
   * Account one transient failure of a request started at `startedAt`. It only
   * COUNTS toward `max` if another request on the channel got through since —
   * i.e. the link is up and this request itself keeps failing. During an outage
   * nothing counts, and the request retries until `giveUpMs` has passed.
   */
  private charge(budget: Budget, channel: Channel, startedAt: number, max: number): 'retry' | 'give-up' {
    this.observe();
    const active = this.activeNow();
    budget.tries += 1;
    budget.firstFailureAt ??= active;
    this.failuresInARow[channel] += 1;
    this.lastFailureAt[channel] = this.now();
    this.lastLinkTroubleAt = this.now();
    this.armLinkExpiry();
    if (this.lastSuccessAt[channel] > startedAt) budget.counted += 1;
    if (budget.counted >= max || active - budget.firstFailureAt >= this.giveUpMs) {
      this.failuresInARow[channel] = 0; // this request stops trying: don't leave "waiting for the network" up
      return 'give-up';
    }
    return 'retry';
  }

  // ---- hash -----------------------------------------------------------------

  private async hashJob(job: Job): Promise<void> {
    const gen = job.gen;
    this.hashing += 1;
    const ctrl = new AbortController();
    job.hashCtrl = ctrl;
    this.set(job, { status: 'hashing', hashedBytes: 0 });
    const readStartedAt = this.now();
    const freshAt = this.freshFrom(job); // bytes before this may come from a cache
    // Watchdog: no progress for HASH_STALL_MS (a stalled network share) ⇒ give
    // up on this read — the slot is freed even if the read never settles.
    // Asleep excluded (a closed lid is not a stalled read); PAUSED time counts:
    // a paused batch still hashes, and a hung read must not hold its slot.
    let lastProgressAt = this.awakeNow();
    const stopWatch = new AbortController();
    let onStall!: (e: Error) => void;
    const stalled = new Promise<never>((_, reject) => (onStall = reject));
    stalled.catch(() => undefined);
    const watch = (async () => {
      while (!stopWatch.signal.aborted) {
        await this.nap(HASH_CHECK_MS, stopWatch.signal);
        if (stopWatch.signal.aborted) return;
        if (this.awakeNow() - lastProgressAt > HASH_STALL_MS) {
          ctrl.abort();
          onStall(new Error('reading it stopped responding'));
          return;
        }
      }
    })();
    try {
      const hex = await Promise.race([
        this.env.hash(
          job.item.source,
          (bytes) => {
            lastProgressAt = this.awakeNow();
            if (bytes > 0) this.noteRead(job, bytes, freshAt);
            if (job.gen === gen) job.view.hashedBytes = bytes;
            this.notify();
          },
          ctrl.signal,
        ),
        stalled,
      ]);
      if (job.gen !== gen) return;
      this.noteRead(job, job.item.source.size, freshAt); // (a 0-byte file read nothing: proves nothing)
      job.sha256 = hex;
      job.hashFailures = 0;
      job.readOkButFailed = 0;
      job.blips = 0;
      job.blipsSince = undefined;
      job.unprovenSince = undefined;
      job.lastFailedReadAt = undefined;
      this.haltedReadFails = 0;
      this.set(job, { hashedBytes: job.item.source.size });
      // Only a copy still IN PROGRESS counts — a finished one says nothing about
      // what the databank holds now (it may have been deleted): ask the server.
      const twin = this.liveTwin(job);
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
      const at = job.view.hashedBytes; // where the read failed
      this.set(job, { status: 'queued', hashedBytes: 0 });
      job.readFailed = true;
      if (this.offline) return; // hashed again once back online
      void this.judgeRead(job, gen, readStartedAt, this.now(), at, e);
    } finally {
      stopWatch.abort();
      this.hashing -= 1;
      if (job.hashCtrl === ctrl) job.hashCtrl = undefined;
      this.schedule();
      await watch;
    }
  }

  /** A read failed while online. It is only the FILE's fault if, AFTER the
   *  failure, (1) the link is proven up (a Drive-streamed file is unreadable
   *  during an ISP outage), (2) the SOURCE is proven up (another file read
   *  fine — else the drive / NAS / Drive client itself is away), and (3) the
   *  file still can't be read at the spot where it failed (the verdict right
   *  after the proof — it may have failed during a blip that is over). Then it
   *  counts; the 3rd counted failure fails the file. Nothing left to test the
   *  source with: only "this file reads fine at that spot" is judged (a broken
   *  file). Otherwise: not counted — the engine enters a read wait (one test
   *  read at a time). */
  private async judgeRead(job: Job, gen: number, readStartedAt: number, failedAt: number, at: number, e: unknown): Promise<void> {
    job.parked = true;
    try {
      const link = await this.linkProvenSince(failedAt);
      if (job.gen !== gen) return;
      if (!link && this.halted) {
        // Paused: no ping is sent, so nothing is known about the link (it is
        // NOT "no internet"). Uncounted — try again once it runs.
        this.haltedReadFails += 1;
        await this.waitForResume(job);
        return;
      }
      // A recent fresh read (SOURCE_PROOF_HOLD_MS) vouches — but only one newer
      // than this file's previous failure (each strike needs its own proof).
      const prevFail = job.lastFailedReadAt;
      job.lastFailedReadAt = failedAt;
      const proofFrom = Math.max(failedAt - SOURCE_PROOF_HOLD_MS, prevFail ?? -Infinity);
      const source = link ? await this.sourceState(failedAt, job, proofFrom) : 'away';
      if (job.gen !== gen) return;
      // Can THIS file be read now, where it failed?
      const size = job.item.source.size;
      const spot = Math.min(at, size - 1);
      const probeSpot = () => (this.env.readable && size > 0 ? this.probe(job, spot, spot + 1) : Promise.resolve('unreadable' as const));
      let again: 'ok' | 'unreadable' | 'unknown' | undefined;
      if (link && source === 'unknown') {
        again = await probeSpot();
        if (job.gen !== gen) return;
      }
      if (!link || source === 'away' || (source === 'unknown' && again !== 'ok')) {
        if (link && source === 'unknown') job.unprovenSince ??= this.activeNow();
        else if (source === 'away') job.unprovenSince = undefined; // the source is away: the long wait
        this.enterReadWait(link ? 'source' : 'link');
        if (this.sourceGaveUp() || this.unprovenTooLong(job)) {
          this.giveUpReads(job, e);
          return;
        }
        await this.waitForSource(job, this.readWaitDelay());
        return;
      }
      job.unprovenSince = undefined;
      again ??= await probeSpot();
      if (job.gen !== gen) return;
      if (again === 'ok') {
        // It reads fine now. If the link (or the source) had trouble while it
        // was being read, that failure was a blip — uncounted, read it again.
        // With no trouble anywhere, a file that fails in full yet reads fine at
        // that spot is broken: that counts after a few tries.
        const trouble = this.lastLinkTroubleAt >= readStartedAt || this.readWaitEndedAt >= readStartedAt;
        const now = this.now();
        // Blips run from the first one at this spot: failing somewhere else
        // (a flap breaks reads all over the file) starts over.
        if (job.blipsSince === undefined || job.lastFailSpot !== at) {
          job.blips = 0;
          job.blipsSince = now;
        }
        job.lastFailSpot = at;
        const blip = trouble && now - job.blipsSince < BLIP_WINDOW_MS;
        if (blip) job.blips += 1;
        if (blip || (job.readOkButFailed += 1) < READ_OK_BUT_FAILED_MAX) {
          await this.backoff(backoffMs(blip ? Math.min(6, 1 + job.blips) : 2, this.env.random), job, false);
          return;
        }
      }
      job.hashFailures += 1;
      if (job.hashFailures >= 3) {
        this.fail(job, `Could not read this file (${errorMessage(e)}). Is it still on this computer?`, true);
        return;
      }
      // Maybe a network drive / Drive stream that hiccuped: try again shortly.
      await this.backoff(backoffMs(job.hashFailures * 2, this.env.random), job, false);
    } finally {
      if (job.gen === gen) job.parked = false;
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
        const startedAt = this.now();
        let res: InitResponse;
        try {
          res = await this.api((signal) => this.transport.init(jobs.map((j) => this.initFile(j)), signal), INIT_TIMEOUT_MS);
          if (!res || (res.mode !== 'proxy' && !Array.isArray((res as { results?: unknown }).results))) {
            throw new TransportError('The server sent an unreadable reply.', 0);
          }
        } catch (e) {
          const status = statusOf(e);
          // Halted (paused / offline / the queue paused on a sign-out): whatever
          // came back — even a 401 — is judged after resume, never here.
          if (this.halted) return; // they stay 'hashed'; resume re-inits them
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
          } else if (
            r.status === 'upload' &&
            !r.resumed && // a RESUMED session belongs to someone (a failed row, another tab) — never free it
            job.view.status === 'cancelled' &&
            job.gen !== sentGens[r.index] &&
            !this.sessionUsedByOther(job, r.uploadId)
          ) {
            // Cancelled while its init was in flight: free the session it opened.
            this.cancelling += 1;
            void this.abortSession(r.uploadId).finally(() => {
              this.cancelling -= 1;
              this.schedule();
            });
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
        this.claimSession(job, r.uploadId);
        job.done = new Set(r.doneParts);
        job.pending = partsToSend(r.partCount, r.doneParts);
        const now = this.now();
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
        this.claimSession(job, r.uploadId);
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
    const f: InFlight = { ctrl: new AbortController(), loaded: 0, lastProgressAt: this.now() };
    job.inflight.set(n, f);
    const attemptAt = this.now(); // before signing: a sign 2xx after this proves the link
    let startedAt = attemptAt;
    try {
      const url = await this.urlFor(job, n);
      if (job.gen !== gen || !url) return; // signing failed and already handled the job
      if (f.reason) throw new TransportError('stopped', 0); // halted while signing
      const [start, end] = partRange(n, session.partSize, job.item.source.size);
      // This part's last attempt found the file unreadable. Judge it NOW, right
      // after a request got through DURING THIS ATTEMPT (usually its own
      // re-sign): unreadable while the link demonstrably works = the file is
      // gone. A proof from before this attempt says nothing about now (the link
      // may have dropped since) — then the PUT itself tells (streamed = readable).
      const since = job.unreadableSince.get(n);
      if (since !== undefined && this.env.readable) {
        const proofAt = Math.max(this.lastSuccessAt.api, this.lastSuccessAt.storage);
        if (proofAt > since && proofAt >= attemptAt) {
          const verdict = await this.probe(job, start, end);
          if (job.gen !== gen) return;
          if (f.reason) throw new TransportError('stopped', 0);
          if (verdict === 'unreadable') {
            // The link works — but does the SOURCE? (A NAS switched off, Drive
            // not reconnected yet: every file is unreadable, none is "gone".)
            const source = await this.sourceState(since, job);
            if (job.gen !== gen) return;
            if (source === 'up') {
              this.fail(job, 'This file changed or is no longer on this computer — drop it again to continue (finished parts are kept).');
              return;
            }
            // Wait for the source: keep the mark, free the slot, come back later.
            // (With files still to hash, their test reads set the pace; with none,
            // part checks do — backing off like test reads, not every 5 s.)
            const hashLane = this.jobs.some((j) => j.view.status === 'queued' || j.view.status === 'hashing');
            if (source === 'unknown') job.unprovenSince ??= this.activeNow();
            else job.unprovenSince = undefined; // the source is away: the long wait
            this.enterReadWait('source', !hashLane);
            if (this.sourceGaveUp() || this.unprovenTooLong(job)) {
              this.fail(job, 'Could not read this file — was it moved, edited or renamed, or its drive disconnected? Drop it again to continue (finished parts are kept).');
              return;
            }
            job.inflight.delete(n);
            this.refreshInFlight(job);
            job.cooling.add(n);
            job.urls.delete(n);
            void this.coolOff(job, gen, n, this.readWaitDelay());
            return;
          }
          if (verdict === 'ok') job.unreadableSince.delete(n);
        }
      }
      startedAt = this.now();
      // (A PUT reads bytes the hash read before — maybe from a cache: it proves
      // nothing about the source. Its sent bytes clear its own part's mark.)
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
      job.unreadableSince.delete(n);
      this.refreshInFlight(job);
      this.onSuccess();
      if (!job.pending.length && !job.inflight.size && !job.cooling.size && job.view.status === 'uploading') {
        this.toComplete(job);
      }
    } catch (e) {
      if (job.gen !== gen) return;
      job.inflight.delete(n);
      this.refreshInFlight(job);
      await this.onPartError(job, gen, n, f, e, startedAt, attemptAt);
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
    attemptAt: number,
  ): Promise<void> {
    // This attempt READ the file (it sent bytes) — however it ended (stall, 5xx,
    // 403, a drop): an older "unreadable" mark is disproved.
    if (f.loaded > 0) job.unreadableSince.delete(n);
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
    // Transient from here on. Reserve the part in `cooling` FIRST: while we
    // probe below it must not look finished (early complete) or be re-queued.
    job.cooling.add(n);
    // No response at all may not be the network: the file itself may have been
    // moved, edited or unplugged — the browser reports that the same way. But a
    // file on a network share / Drive stream is ALSO unreadable during an
    // outage, so an "unreadable" probe here only MARKS the part; the next
    // attempt re-signs first and judges it right after that proof (sendPart).
    if (f.reason !== 'stall' && statusOf(e) === 0 && this.env.readable && job.session) {
      const [start, end] = partRange(n, job.session.partSize, job.item.source.size);
      const verdict = await this.probe(job, start, end);
      if (job.gen !== gen) return;
      if (verdict === 'unreadable') {
        if (!job.unreadableSince.has(n)) job.unreadableSince.set(n, this.now());
        job.urls.delete(n); // the next attempt signs first: that answer shows whether the link is up
      } else if (verdict === 'ok') {
        job.unreadableSince.delete(n);
      }
    }
    this.onTrouble();
    let budget = job.partBudgets.get(n);
    if (!budget) job.partBudgets.set(n, (budget = newBudget()));
    if (this.charge(budget, 'storage', startedAt, MAX_PART_ATTEMPTS) === 'give-up') {
      this.fail(job, 'The connection kept dropping. Retry when your internet is stable — finished parts are kept.');
      return;
    }
    const cool = this.coolOff(job, gen, n, backoffMs(budget.tries, this.env.random));
    // Link up (other PUTs got through): this part's trouble is its own — free the
    // slot for other parts/files now. Link down: keep holding it, so an outage
    // retries a few parts slowly instead of firing every pending part at once.
    if (this.lastSuccessAt.storage > startedAt) return;
    await cool;
  }

  /** Back off, then put the part back in the queue (unless the job moved on). */
  private async coolOff(job: Job, gen: number, n: number, ms: number): Promise<void> {
    await this.backoff(ms, job);
    if (job.gen === gen && job.cooling.delete(n) && !job.pending.includes(n) && !job.inflight.has(n)) {
      job.pending.unshift(n);
    }
    this.schedule();
  }

  /** Read one byte of the source: 'ok', 'unreadable', or 'unknown' when the
   *  read itself hangs (a stalled network share) — raced against 30 s. */
  private async probe(job: Job, start: number, end: number): Promise<'ok' | 'unreadable' | 'unknown'> {
    const read = this.env.readable!(job.item.source, start, end).then(
      (ok) => (ok ? 'ok' : 'unreadable') as 'ok' | 'unreadable',
      () => 'unreadable' as const,
    );
    const stop = new AbortController();
    const timeout = this.nap(PROBE_TIMEOUT_MS, stop.signal).then(() => 'unknown' as const);
    const freshAt = this.freshFrom(job);
    try {
      const verdict = await Promise.race([read, timeout]);
      if (verdict === 'ok') this.noteRead(job, start + 1, freshAt);
      else if (verdict === 'unreadable') job.readFailed = true;
      return verdict;
    } finally {
      stop.abort();
    }
  }

  /** PUT with a stall watchdog: no progress for STALL_MS ⇒ abort (retried).
   *  The window starts HERE — time spent signing the URL never counts. */
  private async putWatched(f: InFlight, url: PartUrl, body: unknown, onTick: () => void): Promise<void> {
    f.lastProgressAt = this.now();
    f.loaded = 0;
    const stop = new AbortController();
    const watch = (async () => {
      while (!stop.signal.aborted) {
        await this.nap(STALL_CHECK_MS, stop.signal);
        if (stop.signal.aborted) return;
        if (this.now() - f.lastProgressAt > STALL_MS) {
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
          if (loaded !== f.loaded) f.lastProgressAt = this.now();
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
      const startedAt = this.now();
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
        if (this.halted) throw e; // judged after resume (see runInit)
        if (classifyApi(status) === 'fatal') {
          this.fail(job, errorMessage(e), status === 401);
          return null;
        }
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
    const now = this.now();
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
    const now = this.now();
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
        const startedAt = this.now();
        let res: CompleteResponse;
        try {
          const ids = [...new Set(jobs.map((j) => j.view.uploadId!))];
          res = await this.api((signal) => this.transport.complete(ids, signal), COMPLETE_TIMEOUT_MS);
          if (!res || !Array.isArray(res.results)) throw new TransportError('The server sent an unreadable reply.', 0);
        } catch (e) {
          const status = statusOf(e);
          if (this.halted) {
            for (const j of live()) j.wantsComplete = true; // re-sent on resume (see runInit)
            return;
          }
          if (classifyApi(status) === 'fatal') {
            for (const j of live()) this.fail(j, errorMessage(e), status === 401);
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
        if (job.cancelRequested) {
          // The officer cancelled it, and the server never recorded it: done.
          this.reset(job);
          this.set(job, { status: 'cancelled', note: undefined });
          return;
        }
        this.reinit(job, 'The upload session expired.');
        return;
      case 'failed':
        if (job.cancelRequested) {
          this.reset(job);
          this.set(job, { status: 'cancelled', note: undefined });
          return;
        }
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
   *  gone), 'finishing' (409 — it is being / has been recorded), or 'gave-up'.
   *  With a `job` (a Cancel the officer is waiting on) it keeps asking under the
   *  outage rules — through pause and offline too, since a Cancel must get a real
   *  answer — until the give-up window. Without one (freeing an orphan session
   *  opened by a cancelled init) it tries 3 times; the sweeper expires the rest. */
  private async abortSession(id: string, job?: Job): Promise<'aborted' | 'finishing' | 'gave-up'> {
    const budget = newBudget();
    const gen = job?.gen;
    for (let attempt = 1; ; attempt++) {
      const startedAt = this.now();
      try {
        await this.api((signal) => this.transport.abort(id, signal), ABORT_TIMEOUT_MS, { haltable: false });
        return 'aborted';
      } catch (e) {
        const status = statusOf(e);
        if (status === 404) return 'aborted';
        if (status === 409) return 'finishing';
        if (classifyApi(status) === 'fatal') return 'gave-up';
        if (!job) {
          if (attempt >= 3) return 'gave-up';
        } else if (this.charge(budget, 'api', startedAt, MAX_API_ATTEMPTS) === 'give-up') {
          return 'gave-up';
        }
        await this.backoff(backoffMs(job ? budget.tries : attempt, this.env.random), undefined, false);
        if (job && job.gen !== gen) return 'gave-up';
      }
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
