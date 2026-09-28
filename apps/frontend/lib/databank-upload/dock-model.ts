/**
 * Everything the upload dock SAYS (Databank Phase 1, PR-7). Pure — the React
 * components only lay it out — so the wording is unit-tested and stays
 * consistent. Written for an officer, not an engineer: what is happening, and
 * whether they need to do anything.
 */
import type { BatchView, QueueSnapshot, RowView } from './queue.ts';
import { formatBytes, formatEta, needsCheck } from './summary.ts';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export type RowAction = 'cancel' | 'retry' | 'discard' | 'skip' | 'upload-anyway' | 'upload-again';

export interface RowDisplay {
  chip: string;
  tone: Tone;
  detail?: string;
  /** 0–100 while bytes are moving, else undefined. */
  pct?: number;
  actions: RowAction[];
  /** Spinner on the chip. */
  busy?: boolean;
}

const nf = new Intl.NumberFormat('en-US');
const n = (x: number) => nf.format(x);
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;

function shortDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Known server messages → plain words; anything else passes through. */
export function plainError(message: string | undefined): string {
  const m = message ?? '';
  let x = /Larger than the (\d+) GB/i.exec(m);
  if (x) return `Too big — the limit is ${x[1]} GB per file.`;
  x = /Files of type \.(\w+) are not allowed/i.exec(m);
  if (x) return `This file type (.${x[1]}) is not allowed in the databank.`;
  if (/assigned to another officer/i.test(m)) return 'You can no longer upload to this client (it was given to another officer).';
  if (/did not match the original/i.test(m)) return 'The file changed while it was uploading — try again.';
  return m || 'Something went wrong.';
}

export function rowView(r: RowView): RowDisplay {
  const moving = r.size > 0 ? Math.round(((r.bytesDone + r.bytesInFlight) / r.size) * 100) : 0;
  const pct = Math.max(0, Math.min(100, moving));
  const kept = r.bytesDone > 0 ? `${formatBytes(r.bytesDone)} already sent earlier` : undefined;
  switch (r.status) {
    case 'queued':
    case 'hashed':
    case 'fallback':
      return { chip: r.legacy ? 'Waiting (standard upload)' : 'Waiting', tone: 'neutral', actions: ['cancel'] };
    case 'hashing': {
      const h = r.size > 0 ? Math.max(0, Math.min(100, Math.round((r.hashedBytes / r.size) * 100))) : 0;
      return {
        chip: `Checking ${h}%`,
        tone: 'info',
        detail: 'Reading the file to recognise it — nothing is sent yet',
        actions: ['cancel'],
      };
    }
    case 'ready':
      return r.resumed
        ? { chip: 'Continuing', tone: 'neutral', detail: kept, actions: ['cancel'] }
        : { chip: 'Waiting', tone: 'neutral', actions: ['cancel'] };
    case 'uploading':
      return {
        chip: `${r.legacy ? 'Uploading (standard)' : 'Uploading'} ${pct}%`,
        tone: 'info',
        pct,
        detail: r.resumed ? 'Continuing from where it stopped' : undefined,
        actions: r.legacy ? [] : ['cancel'],
      };
    case 'completing':
      return { chip: 'Saving…', tone: 'info', busy: true, actions: [], detail: r.note };
    case 'cancelling':
      return { chip: 'Cancelling…', tone: 'neutral', busy: true, actions: [] };
    case 'done':
      if (r.relocated) {
        const where = 'Saved at the top of the databank — its folder was deleted while uploading';
        return { chip: 'Saved', tone: 'warning', detail: r.note ? `${where}. ${r.note}` : where, actions: [] };
      }
      return { chip: 'Saved', tone: r.note ? 'warning' : 'success', detail: r.note, actions: [] };
    case 'handed-off':
      return r.note
        ? { chip: 'Saved', tone: 'warning', detail: `The server is finishing it. ${r.note}`, actions: [] }
        : { chip: 'Saved', tone: 'success', detail: 'The server is finishing it — it appears in a few minutes', actions: [] };
    case 'skipped':
      if (r.duplicateKind === 'already-uploaded') {
        return { chip: 'Already there', tone: 'success', detail: `In ${r.existing?.folderName ?? 'the top folder'}`, actions: [] };
      }
      if (r.duplicateKind === 'same-drop') return { chip: 'Same file twice', tone: 'neutral', detail: r.note, actions: [] };
      return { chip: 'Skipped', tone: 'neutral', actions: [] };
    case 'needs-decision': {
      const where = r.existing?.folderName ?? 'the top folder';
      const when = shortDate(r.existing?.createdAt);
      if (r.duplicateKind === 'possible-duplicate') {
        return {
          chip: 'Maybe already there',
          tone: 'warning',
          detail: `A file with the same name and size was uploaded here${when ? ` on ${when}` : ''}`,
          actions: ['skip', 'upload-anyway'],
        };
      }
      return {
        chip: 'Already in databank',
        tone: 'warning',
        detail: `Same file is in ${where}${r.existing?.fileName ? ` as “${r.existing.fileName}”` : ''}${when ? ` (${when})` : ''}`,
        actions: ['skip', 'upload-anyway'],
      };
    }
    case 'failed':
      // (its Cancel went unanswered, or came while it was being saved: the officer
      // wanted it gone — Remove, which tries the cancel again, not Retry)
      if (r.bulkSkip) return { chip: 'Not uploaded', tone: 'danger', detail: r.note ? `${plainError(r.error)} ${r.note}` : plainError(r.error), actions: ['discard'] };
      return r.retryable === false
        ? { chip: 'Not allowed', tone: 'danger', detail: plainError(r.error), actions: ['discard'] }
        : { chip: 'Not uploaded', tone: 'danger', detail: r.note ? `${plainError(r.error)} ${r.note}` : plainError(r.error), actions: ['retry', 'discard'] };
    case 'cancelled':
      return { chip: 'Cancelled', tone: 'neutral', detail: r.note, actions: ['upload-again'] };
    default:
      return { chip: String(r.status), tone: 'neutral', actions: [] };
  }
}

/** Failed rows "Retry failed" will actually retry (its button shows this count). */
export function bulkRetryable(rows: RowView[]): number {
  let n = 0;
  for (const r of rows) if (r.status === 'failed' && r.retryable !== false && !r.bulkSkip) n += 1;
  return n;
}

/** "done around 6:50 PM" — only for ETAs of 10 minutes or more. */
export function formatFinishAt(etaSeconds: number | null, now: number, locale = 'en-US'): string | null {
  if (etaSeconds === null || etaSeconds < 600) return null;
  const t = new Date(now + etaSeconds * 1000);
  return `done around ${t.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`;
}

export interface Headline {
  title: string;
  sub?: string;
}

export function dockHeadline(s: QueueSnapshot, now: number): Headline {
  const sum = s.summary;
  const total = sum.files;
  const unfinished = sum.uploading + sum.waiting;
  if (s.authLost) return { title: 'Paused — you were signed out' };
  if (s.offline || s.linkDown) return { title: 'Waiting for internet…', sub: unfinished ? `${plural(unfinished, 'file')} waiting` : undefined };
  if (s.readsWaiting && unfinished) {
    return {
      title: 'Can’t read the files — is the drive connected?',
      sub: `${plural(unfinished, 'file')} waiting — they continue by themselves once it is`,
    };
  }
  if (s.paused && unfinished) return { title: `Paused — ${plural(unfinished, 'file')} waiting` };
  if (s.active) {
    const hashingOnly = s.batches.every((b) => b.rows.every((r) => r.status !== 'uploading' && r.status !== 'completing'));
    if (hashingOnly && sum.completed === 0) {
      const checked = s.batches.reduce((a, b) => a + b.rows.filter((r) => r.status !== 'queued' && r.status !== 'hashing').length, 0);
      return { title: 'Checking files… nothing is sent yet', sub: `${n(checked)} of ${n(total)} checked` };
    }
    const bits = [`${formatBytes(sum.bytesSent)} of ${formatBytes(sum.bytesTotal)}`];
    if (s.bytesPerSecond >= 1) bits.push(`${formatBytes(s.bytesPerSecond)}/s`);
    const eta = formatEta(s.etaSeconds);
    if (eta) bits.push(eta);
    const finish = formatFinishAt(s.etaSeconds, now);
    if (finish) bits.push(finish);
    return { title: `Uploading ${n(sum.completed + sum.uploading)} of ${n(total)} files`, sub: bits.join(' · ') };
  }
  const issues = sum.failed + sum.needsDecision + s.batches.filter((b) => b.state === 'prepare-failed').length;
  const left = s.batches.reduce((a, b) => a + b.skipped.length, 0); // not uploaded (e.g. folder names too long)
  const checks = s.batches.reduce((a, b) => a + b.rows.filter(needsCheck).length, 0);
  const saved = sum.completed;
  // (Never "All N files saved" while some were cancelled — or need a look in the folder.)
  if (issues || left || checks || sum.cancelled) {
    const bits = [`${n(saved)} saved`];
    if (sum.cancelled) bits.push(`${n(sum.cancelled)} cancelled`);
    if (left) bits.push(`${n(left)} not uploaded`);
    if (checks) bits.push(`${n(checks)} to check`);
    if (issues) bits.push(plural(issues, 'needs attention', 'need attention'));
    return { title: bits.join(' · ') };
  }
  const already = sum.skipped ? ` · ${n(sum.skipped)} already there` : '';
  return { title: `All ${plural(saved, 'file')} saved${already}` };
}

export interface BatchSection {
  key: 'choice' | 'problems' | 'check' | 'progress' | 'waiting' | 'saved' | 'cancelled' | 'not-uploaded';
  title: string;
  rows: RowView[];
  /** Rows not rendered (performance cap). */
  more: number;
  collapsed: boolean;
}

const CAP = 200;
const WAITING_CAP = 20;
const SAVED_CAP = 50;

/** A batch's rows grouped the way an officer reads them: what needs me first. */
export function batchSections(b: BatchView): BatchSection[] {
  const choice: RowView[] = [];
  const problems: RowView[] = [];
  const progress: RowView[] = [];
  const waiting: RowView[] = [];
  const check: RowView[] = [];
  const saved: RowView[] = [];
  const cancelled: RowView[] = [];
  for (const r of b.rows) {
    if (r.status === 'needs-decision') choice.push(r);
    else if (r.status === 'failed') problems.push(r);
    else if (r.status === 'hashing' || r.status === 'uploading' || r.status === 'completing' || r.status === 'cancelling') progress.push(r);
    else if (r.status === 'queued' || r.status === 'hashed' || r.status === 'ready' || r.status === 'fallback') waiting.push(r);
    else if (needsCheck(r)) check.push(r); // a Cancel that came while it was being saved
    else if (r.status === 'cancelled') cancelled.push(r);
    else saved.push(r); // done, handed-off, skipped
  }
  const out: BatchSection[] = [];
  const add = (key: BatchSection['key'], title: string, rows: RowView[], cap: number, collapsed = false, newest = false) => {
    if (!rows.length) return;
    out.push({ key, title, rows: newest ? rows.slice(-cap) : rows.slice(0, cap), more: Math.max(0, rows.length - cap), collapsed });
  };
  add('choice', `Needs your choice (${n(choice.length)})`, choice, CAP);
  add('problems', `Problems (${n(problems.length)})`, problems, CAP);
  // Open by default: the officer asked to cancel these, and they may be in the folder anyway.
  add('check', `Check the folder (${n(check.length)})`, check, CAP);
  add('progress', 'In progress', progress, CAP);
  add('waiting', `Waiting (${n(waiting.length)})`, waiting, WAITING_CAP);
  const already = saved.filter((r) => r.status === 'skipped').length;
  const savedTitle = already ? `${n(saved.length - already)} saved · ${n(already)} already there` : `${n(saved.length)} saved`;
  add('saved', savedTitle, saved, SAVED_CAP, true, true);
  add('cancelled', `Cancelled (${n(cancelled.length)})`, cancelled, CAP, true);
  if (b.skipped.length) {
    // Open by default: these files are NOT in the databank — the officer must see why.
    out.push({ key: 'not-uploaded', title: `Not uploaded (${n(b.skipped.length)})`, rows: [], more: 0, collapsed: false });
  }
  return out;
}

/** One line under the batch title. */
export function batchStateLine(b: BatchView): { text: string; tone: Tone } {
  switch (b.state) {
    case 'preparing':
      return { text: 'Getting the folder ready…', tone: 'info' };
    case 'prepare-failed':
      return { text: `Could not create the folders: ${plainError(b.prepareError)} Nothing was uploaded.`, tone: 'danger' };
    case 'waiting-turn':
      return { text: 'Waiting its turn — another big upload is running', tone: 'neutral' };
    case 'paused':
      return { text: 'Paused', tone: 'neutral' };
    case 'needs-you':
      return { text: 'Needs your choice', tone: 'warning' };
    case 'finished': {
      const s = b.summary;
      const left = b.skipped.length;
      const checks = b.rows.filter(needsCheck).length;
      if (s.failed || left || checks || s.cancelled) {
        const bits = [`${n(s.completed)} saved`];
        if (s.cancelled) bits.push(`${n(s.cancelled)} cancelled`);
        if (left) bits.push(`${n(left)} not uploaded`);
        if (checks) bits.push(`${n(checks)} to check`);
        if (s.failed) bits.push(plural(s.failed, 'problem'));
        return { text: bits.join(' · '), tone: s.failed || left || checks ? 'warning' : 'neutral' };
      }
      return { text: `${n(s.completed)} saved${s.skipped ? ` · ${n(s.skipped)} already there` : ''}`, tone: 'success' };
    }
    default: {
      const s = b.summary;
      return { text: `${n(s.completed)} of ${n(s.files)} saved`, tone: 'info' };
    }
  }
}
