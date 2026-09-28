/**
 * The upload dock's header, computed from an engine snapshot:
 *   "7 files — 3 completed · 2 uploading · 1 waiting · 1 failed — 4.1 of 20.3 GB · 6.2 MB/s · ~48 min"
 * Pure, so the wording and the byte maths are unit-tested.
 */
import type { FileStatus, FileView } from './engine.ts';

export interface UploadSummary {
  files: number;
  completed: number;
  /** Bytes moving now: hashing, uploading, being recorded. */
  uploading: number;
  /** Not started yet (queued / hashed / session open, waiting for a slot). */
  waiting: number;
  skipped: number;
  needsDecision: number;
  failed: number;
  cancelled: number;
  /** Bytes confirmed + in flight, over the files that will be uploaded. */
  bytesSent: number;
  bytesTotal: number;
  /** True while anything can still make progress. */
  active: boolean;
}

const GROUP: Record<FileStatus, keyof UploadSummary> = {
  queued: 'waiting',
  hashed: 'waiting',
  ready: 'waiting',
  hashing: 'uploading',
  uploading: 'uploading',
  completing: 'uploading',
  done: 'completed',
  'handed-off': 'completed',
  skipped: 'skipped',
  'needs-decision': 'needsDecision',
  fallback: 'waiting',
  failed: 'failed',
  cancelled: 'cancelled',
};

/** Files whose bytes do not count toward "x of y GB". */
const NOT_SENT: ReadonlySet<FileStatus> = new Set(['skipped', 'cancelled', 'needs-decision', 'fallback']);

export function summarize(files: FileView[]): UploadSummary {
  const s: UploadSummary = {
    files: files.length,
    completed: 0,
    uploading: 0,
    waiting: 0,
    skipped: 0,
    needsDecision: 0,
    failed: 0,
    cancelled: 0,
    bytesSent: 0,
    bytesTotal: 0,
    active: false,
  };
  for (const f of files) {
    (s[GROUP[f.status]] as number) += 1;
    if (NOT_SENT.has(f.status)) continue;
    s.bytesTotal += f.size;
    s.bytesSent += Math.min(f.size, f.bytesDone + f.bytesInFlight);
  }
  s.active = s.uploading + s.waiting > 0;
  return s;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1,000-based like Drive/Windows Explorer: "950 KB", "4.1 GB", "12 GB". */
export function formatBytes(n: number): string {
  let v = Math.max(0, n);
  let u = 0;
  while (v >= 1000 && u < UNITS.length - 1) {
    v /= 1000;
    u += 1;
  }
  const text = u === 0 || v >= 10 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, '');
  return `${text} ${UNITS[u]}`;
}

/** "~48 min", "~2 h 5 min", "< 1 min". */
export function formatEta(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return '< 1 min';
  const min = Math.round(seconds / 60);
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `~${h} h ${m} min` : `~${h} h`;
}

export function headline(s: UploadSummary, bytesPerSecond: number, etaSeconds: number | null): string {
  const counts = [
    s.completed && `${s.completed} completed`,
    s.uploading && `${s.uploading} uploading`,
    s.waiting && `${s.waiting} waiting`,
    s.needsDecision && `${s.needsDecision} to review`,
    s.skipped && `${s.skipped} already there`,
    s.failed && `${s.failed} failed`,
    s.cancelled && `${s.cancelled} cancelled`,
  ].filter(Boolean);
  const parts = [`${s.files} ${s.files === 1 ? 'file' : 'files'}${counts.length ? ` — ${counts.join(' · ')}` : ''}`];
  if (s.bytesTotal > 0) {
    const bytes = [`${formatBytes(s.bytesSent)} of ${formatBytes(s.bytesTotal)}`];
    if (s.active && bytesPerSecond >= 1) bytes.push(`${formatBytes(bytesPerSecond)}/s`);
    const eta = s.active ? formatEta(etaSeconds) : null;
    if (eta) bytes.push(eta);
    parts.push(bytes.join(' · '));
  }
  return parts.join(' — ');
}
