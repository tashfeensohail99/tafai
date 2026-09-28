'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { memo, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  UploadCloud,
  WifiOff,
  X,
} from 'lucide-react';
import { getUploadQueue, useUploadQueue } from '@/lib/databank-upload-browser';
import { batchSections, batchStateLine, dockHeadline, rowView } from '@/lib/databank-upload/dock-model';
import { needsCheck } from '@/lib/databank-upload/summary';
import type { RowAction, Tone } from '@/lib/databank-upload/dock-model';
import type { BatchView, QueueNotice, RowView } from '@/lib/databank-upload/queue';

const COLLAPSED_KEY = 'databank.uploadDock.collapsed';
const readCollapsed = (): boolean => {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};
const writeCollapsed = (v: boolean) => {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
  } catch {
    /* storage blocked */
  }
};

const badge = (tone: Tone) => `sos-badge sos-badge--${tone}`;

const ACTION_LABEL: Record<RowAction, string> = {
  cancel: 'Cancel',
  retry: 'Retry',
  discard: 'Remove',
  skip: 'Skip',
  'upload-anyway': 'Upload anyway',
  'upload-again': 'Upload again',
};

function runAction(r: RowView, a: RowAction) {
  const q = getUploadQueue();
  switch (a) {
    case 'cancel':
      void q.cancel(r.rowId);
      break;
    case 'retry':
    case 'upload-again':
      q.retry(r.rowId);
      break;
    case 'discard':
      void q.discard(r.rowId);
      break;
    case 'skip':
      q.resolveDuplicate(r.rowId, 'skip');
      break;
    case 'upload-anyway':
      q.resolveDuplicate(r.rowId, 'upload');
      break;
  }
}

const UploadRow = memo(
  function UploadRow({ r }: { r: RowView }) {
    const v = rowView(r);
    return (
      <div className="sos-upload-dock__row">
        <div style={{ minWidth: 0 }}>
          <div className="sos-truncate" title={r.relativePath ?? r.fileName} style={{ fontWeight: 600 }}>
            {r.fileName}
          </div>
          {v.detail ? (
            <div className="sos-truncate" style={{ opacity: 0.75 }} title={v.detail}>
              {v.detail}
            </div>
          ) : r.relativePath && r.relativePath !== r.fileName ? (
            <div className="sos-truncate" style={{ opacity: 0.6 }}>
              {r.relativePath.slice(0, r.relativePath.length - r.fileName.length - 1)}
            </div>
          ) : null}
          {v.pct !== undefined ? (
            <div className="sos-progress" style={{ height: 3, marginTop: 4 }}>
              <div className="sos-progress__fill" style={{ width: `${v.pct}%` }} />
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span className={badge(v.tone)}>
            {v.busy ? <Loader2 size={11} className="sos-spin" style={{ marginRight: 4 }} /> : null}
            {v.chip}
          </span>
          {v.actions.map((a) => (
            <button key={a} type="button" className="sos-btn sos-btn--sm sos-btn--ghost" onClick={() => runAction(r, a)}>
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      </div>
    );
  },
  // Re-render a row only when what it SHOWS changes (a 20k-file drop flushes
  // four times a second).
  (a, b) => {
    if (a.r.rowId !== b.r.rowId || a.r.fileName !== b.r.fileName || a.r.relativePath !== b.r.relativePath) return false;
    const x = rowView(a.r);
    const y = rowView(b.r);
    return (
      x.chip === y.chip &&
      x.tone === y.tone &&
      x.detail === y.detail &&
      x.pct === y.pct &&
      x.busy === y.busy &&
      x.actions.join() === y.actions.join()
    );
  },
);

function BatchGroup({ b }: { b: BatchView }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const notUploaded = b.skipped.length + b.summary.failed + b.summary.needsDecision + (b.state === 'prepare-failed' ? 1 : 0);
  const toCheck = b.rows.filter(needsCheck).length;
  const leftOut = notUploaded + toCheck;
  const canDismiss = b.state === 'finished' || b.state === 'needs-you' || b.state === 'prepare-failed';
  // A confirm left open must not come back later, unasked, with other numbers.
  useEffect(() => {
    setConfirmDismiss(false);
  }, [b.state, leftOut]);
  const state = batchStateLine(b);
  const s = b.summary;
  const pct = s.bytesTotal > 0 ? Math.round((s.bytesSent / s.bytesTotal) * 100) : 0;
  const q = getUploadQueue();
  const title = b.rootNames.length ? `${b.label} › ${b.rootNames[0]}${b.rootNames.length > 1 ? ` +${b.rootNames.length - 1}` : ''}` : `${b.label} · ${s.files} ${s.files === 1 ? 'file' : 'files'}`;
  return (
    <section style={{ borderTop: '1px solid var(--sos-border-subtle)', padding: '8px 0' }}>
      <div style={{ padding: '0 var(--sos-space-4)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {b.href ? (
            <Link href={b.href as Route} className="sos-truncate" style={{ fontWeight: 700 }}>
              {title}
            </Link>
          ) : (
            <span className="sos-truncate" style={{ fontWeight: 700 }}>
              {title}
            </span>
          )}
          <span className={badge(state.tone)} style={{ marginLeft: 'auto', flexShrink: 0 }}>
            {state.text.length > 42 ? `${state.text.slice(0, 40)}…` : state.text}
          </span>
        </div>
        <div className="sos-truncate" style={{ fontSize: 12, opacity: 0.7 }}>
          Into {b.parentLabel}
          {b.alreadyListed ? ` · ${b.alreadyListed} already in the list` : ''}
        </div>
        {b.state === 'prepare-failed' ? (
          <div className="sos-banner sos-banner--danger" style={{ fontSize: 12.5 }}>
            {state.text}
            <button type="button" className="sos-btn sos-btn--sm" onClick={() => q.retryPrepare(b.id)}>
              Try again
            </button>
          </div>
        ) : null}
        {b.state === 'needs-you' && s.needsDecision > 1 ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
            {s.needsDecision.toLocaleString('en-US')} files may already be in the databank:
            <button type="button" className="sos-btn sos-btn--sm sos-btn--secondary" onClick={() => q.resolveAllDuplicates(b.id, 'skip')}>
              Skip all
            </button>
            <button type="button" className="sos-btn sos-btn--sm sos-btn--ghost" onClick={() => q.resolveAllDuplicates(b.id, 'upload')}>
              Upload all anyway
            </button>
          </div>
        ) : null}
        {b.state !== 'preparing' && b.state !== 'prepare-failed' && s.bytesTotal > 0 ? (
          <div className="sos-progress" style={{ height: 4 }}>
            <div className="sos-progress__fill" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {b.state === 'waiting-turn' ? (
            <button type="button" className="sos-btn sos-btn--sm sos-btn--secondary" onClick={() => q.prioritize(b.id)}>
              Start now
            </button>
          ) : null}
          {s.failed ? (
            <button type="button" className="sos-btn sos-btn--sm sos-btn--ghost" onClick={() => q.retryFailed(b.id)}>
              <RotateCcw size={12} /> Retry failed
            </button>
          ) : null}
          {b.state === 'running' || b.state === 'waiting-turn' || b.state === 'paused' || b.state === 'preparing' || b.state === 'needs-you' ? (
            <button type="button" className="sos-btn sos-btn--sm sos-btn--ghost" onClick={() => void q.cancelBatch(b.id)}>
              Cancel
            </button>
          ) : null}
          {canDismiss && !confirmDismiss ? (
            <button
              type="button"
              className="sos-btn sos-btn--sm sos-btn--ghost"
              onClick={() => (leftOut ? setConfirmDismiss(true) : q.dismissBatch(b.id))}
            >
              Dismiss
            </button>
          ) : null}
          {canDismiss && confirmDismiss ? (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
              {b.state === 'prepare-failed'
                ? 'Nothing from this folder was uploaded — remove it from the list?'
                : `${[
                    notUploaded ? `${notUploaded === 1 ? '1 file was' : `${notUploaded.toLocaleString('en-US')} files were`} not uploaded` : '',
                    toCheck ? `${toCheck === 1 ? '1 file needs' : `${toCheck.toLocaleString('en-US')} files need`} checking in the folder` : '',
                  ]
                    .filter(Boolean)
                    .join(' and ')} — remove this list anyway?`}
              <button type="button" className="sos-btn sos-btn--sm sos-btn--danger" onClick={() => q.dismissBatch(b.id)}>
                Remove
              </button>
              <button type="button" className="sos-btn sos-btn--sm sos-btn--ghost" onClick={() => setConfirmDismiss(false)}>
                Keep
              </button>
            </span>
          ) : null}
        </div>
      </div>
      {batchSections(b).map((sec) => {
        const isOpen = open[sec.key] ?? !sec.collapsed;
        return (
          <div key={sec.key}>
            <button
              type="button"
              className="sos-btn sos-btn--sm sos-btn--ghost"
              style={{ width: '100%', justifyContent: 'flex-start', padding: '4px var(--sos-space-4)' }}
              onClick={() => setOpen((o) => ({ ...o, [sec.key]: !isOpen }))}
              aria-expanded={isOpen}
            >
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {sec.title}
            </button>
            {isOpen && sec.key === 'not-uploaded' ? (
              <div style={{ padding: '0 var(--sos-space-4) 6px', fontSize: 12 }}>
                {b.skipped.slice(0, 200).map((x) => (
                  <div key={x.path} className="sos-truncate" title={`${x.path} — ${x.reason}`}>
                    {x.path} — {x.reason}
                  </div>
                ))}
              </div>
            ) : null}
            {isOpen && sec.rows.map((r) => <UploadRow key={r.rowId} r={r} />)}
            {isOpen && sec.more ? (
              <div style={{ padding: '2px var(--sos-space-4)', fontSize: 12, opacity: 0.7 }}>+{sec.more} more</div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

/** Another officer signed in: the uploads stopped — say so, and what was left. */
function StoppedNotice({ notice, onOk }: { notice: QueueNotice; onOk: () => void }) {
  return (
    <div className="sos-upload-dock__header" role="alert">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <AlertTriangle size={16} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Uploads stopped — someone else signed in on this browser</div>
          {notice.lost.map((l, i) => (
            <div key={`${l.ownerSub ?? ''}|${l.tKey ?? l.label}|${i}`} style={{ fontSize: 12.5, opacity: 0.8 }}>
              {l.count.toLocaleString('en-US')} {l.count === 1 ? 'file' : 'files'} for {l.label} were not uploaded.
            </div>
          ))}
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            Sign back in and drop the same files or folder again — saved files are skipped, half-sent ones continue.
          </div>
        </div>
      </div>
      <div>
        <button type="button" className="sos-btn sos-btn--sm" onClick={onOk}>
          OK
        </button>
      </div>
    </div>
  );
}

export default function UploadDock() {
  const snap = useUploadQueue();
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed());
  const [confirmCancel, setConfirmCancel] = useState(false);
  const q = getUploadQueue();
  const unfinishedNow = snap.summary.uploading + snap.summary.waiting;
  // A "Stop the remaining N files?" left open must not greet the NEXT drop.
  useEffect(() => {
    if (!unfinishedNow || collapsed) setConfirmCancel(false);
  }, [unfinishedNow, collapsed]);

  useEffect(() => {
    const el = document.documentElement;
    if (snap.batches.length) el.classList.add('has-upload-dock');
    else el.classList.remove('has-upload-dock');
    return () => el.classList.remove('has-upload-dock');
  }, [snap.batches.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !collapsed) {
        setCollapsed(true);
        writeCollapsed(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapsed]);

  const notice = snap.notice ? <StoppedNotice notice={snap.notice} onOk={() => q.dismissNotice()} /> : null;
  if (notice && !snap.batches.length) {
    return (
      <section className="sos-upload-dock sos-glass sos-glass--strong" role="region" aria-label="Uploads stopped">
        {notice}
      </section>
    );
  }
  if (!snap.batches.length) return null;
  const h = dockHeadline(snap, Date.now());
  const s = snap.summary;
  const pct = s.bytesTotal > 0 ? Math.round((s.bytesSent / s.bytesTotal) * 100) : 0;
  const unfinished = s.uploading + s.waiting;
  const icon = snap.authLost ? (
    <AlertTriangle size={16} />
  ) : snap.offline || snap.linkDown ? (
    <WifiOff size={16} />
  ) : snap.paused ? (
    <Pause size={16} />
  ) : snap.active ? (
    <Loader2 size={16} className="sos-spin" />
  ) : snap.attention ? (
    <AlertTriangle size={16} />
  ) : (
    <CheckCircle2 size={16} />
  );

  if (collapsed) {
    return (
      <button
        type="button"
        className="sos-upload-dock sos-upload-dock--pill sos-glass sos-glass--strong"
        onClick={() => {
          setCollapsed(false);
          writeCollapsed(false);
        }}
        aria-label={`Uploads: ${h.title}. Open`}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
          {icon}
          <span className="sos-truncate" style={{ fontWeight: 600 }}>
            {h.title}
          </span>
          {snap.attention ? <span className="sos-badge sos-badge--warning">{snap.attention} need you</span> : null}
          {snap.notice ? <span className="sos-badge sos-badge--warning">Uploads stopped</span> : null}
        </div>
        {snap.active ? (
          <div className="sos-progress" style={{ height: 3, borderRadius: 0 }}>
            <div className="sos-progress__fill" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </button>
    );
  }

  return (
    <section className="sos-upload-dock sos-glass sos-glass--strong" role="region" aria-label="Uploads">
      <header className="sos-upload-dock__header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ marginTop: 2 }}>{icon}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{h.title}</div>
            {h.sub ? <div style={{ fontSize: 12.5, opacity: 0.75 }}>{h.sub}</div> : null}
          </div>
          <button
            type="button"
            className="sos-btn sos-btn--sm sos-btn--ghost"
            aria-label="Minimise uploads"
            onClick={() => {
              setCollapsed(true);
              writeCollapsed(true);
            }}
          >
            <Minimize2 size={14} />
          </button>
        </div>
        {snap.active ? (
          <div className="sos-progress" style={{ height: 4 }}>
            <div className="sos-progress__fill" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {unfinished ? (
            snap.paused ? (
              <button type="button" className="sos-btn sos-btn--sm sos-btn--secondary" onClick={() => q.resumeAll()}>
                <Play size={12} /> Resume
              </button>
            ) : (
              <button type="button" className="sos-btn sos-btn--sm sos-btn--ghost" onClick={() => q.pauseAll()}>
                <Pause size={12} /> Pause all
              </button>
            )
          ) : null}
          {s.failed ? (
            <button type="button" className="sos-btn sos-btn--sm sos-btn--ghost" onClick={() => q.retryFailed()}>
              <RotateCcw size={12} /> Retry failed ({s.failed})
            </button>
          ) : null}
          {unfinished ? (
            confirmCancel ? (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                Stop the remaining {unfinished} files? Saved files stay.
                <button
                  type="button"
                  className="sos-btn sos-btn--sm sos-btn--danger"
                  onClick={() => {
                    setConfirmCancel(false);
                    void q.cancelAll();
                  }}
                >
                  Stop
                </button>
                <button type="button" className="sos-btn sos-btn--sm sos-btn--ghost" onClick={() => setConfirmCancel(false)}>
                  Keep going
                </button>
              </span>
            ) : (
              <button type="button" className="sos-btn sos-btn--sm sos-btn--ghost" onClick={() => setConfirmCancel(true)}>
                <X size={12} /> Cancel all
              </button>
            )
          ) : null}
          {!unfinished ? (
            <button type="button" className="sos-btn sos-btn--sm sos-btn--ghost" onClick={() => q.clearFinished()}>
              Clear finished
            </button>
          ) : null}
        </div>
      </header>
      {snap.authLost ? (
        <div className="sos-banner sos-banner--danger" style={{ margin: 8, fontSize: 12.5 }}>
          You were signed out — uploads are paused and nothing is lost. Sign in again in a NEW tab (not with Sign out
          here — that stops the uploads); they continue by themselves.
          <button
            type="button"
            className="sos-btn sos-btn--sm"
            onClick={() => window.open('/login', '_blank', 'noopener')}
          >
            Sign in (new tab)
          </button>
          <button type="button" className="sos-btn sos-btn--sm sos-btn--ghost" onClick={() => void q.checkAuth()}>
            Continue
          </button>
        </div>
      ) : snap.offline || snap.linkDown ? (
        <div className="sos-banner sos-banner--warning" style={{ margin: 8, fontSize: 12.5 }}>
          Waiting for internet — nothing is lost. It continues by itself.
        </div>
      ) : null}
      {notice}
      {!snap.offline && !snap.linkDown && snap.readsWaiting && unfinished > 0 ? (
        <div className="sos-banner sos-banner--warning" style={{ margin: 8, fontSize: 12.5 }}>
          Can’t read the files right now — is the USB drive, network drive or Google Drive connected? Nothing is lost;
          the uploads continue by themselves once it is. If you moved, renamed or edited a file after dropping it, cancel
          it and drop it again.
        </div>
      ) : null}
      {snap.compat ? (
        <div className="sos-banner sos-banner--info" style={{ margin: 8, fontSize: 12.5 }}>
          This server is using the standard upload — files over 2 GB can’t be uploaded right now.
        </div>
      ) : null}
      {snap.active ? (
        <div className="sos-banner sos-banner--info" style={{ margin: 8, fontSize: 12.5 }}>
          <UploadCloud size={14} /> Keep this tab open until uploads finish. You can keep working on other pages.
        </div>
      ) : null}
      <div className="sos-upload-dock__list sos-scroll">
        {snap.batches.map((b) => (
          <BatchGroup key={b.id} b={b} />
        ))}
      </div>
      <span className="sos-upload-dock__sr" aria-live="polite">
        {snap.authLost
          ? 'Uploads paused: signed out'
          : snap.offline || snap.linkDown
            ? 'Uploads waiting for internet'
            : !snap.active && snap.batches.length
              ? h.title
              : snap.attention
                ? `${snap.attention} uploads need attention`
                : ''}
      </span>
    </section>
  );
}
