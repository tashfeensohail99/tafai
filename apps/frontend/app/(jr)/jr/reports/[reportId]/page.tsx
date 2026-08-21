'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Loader2,
  Lock,
  Mail,
  Mic,
  NotebookPen,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  FormInput,
  FormTextarea,
} from '@/components/sales-v2/ui';
import { ApiClientError } from '@/lib/api-client';
import { useJrSession } from '@/components/layout/JrShell';
import {
  addReportNote,
  deleteReportAttachment,
  deleteReportNote,
  emailWorkReport,
  fetchWorkReport,
  finalizeWorkReport,
  openWorkReportPdf,
  reportAttachmentSignedUrl,
  uploadReportImage,
  uploadReportVoice,
  jrFmtDate,
  jrHumanize,
  workReportStatusTone,
  type HydratedWorkReport,
  type WorkReportAttachment,
} from '@/lib/jr';

function errMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

function extForMime(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'mp4';
  return 'webm';
}

const SECTION: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--sos-text-muted)',
  marginBottom: 8,
};

// ---------------------------------------------------------------------------
// Summary tiles
// ---------------------------------------------------------------------------
function SummaryTiles({ body }: { body: HydratedWorkReport['body'] }) {
  const s = body.summary;
  const tiles: Array<{ k: string; v: number }> = [
    { k: 'Matters', v: s.matterCount },
    { k: 'Draft versions', v: s.draftVersions },
    { k: 'Submitted', v: s.submittedForReview },
    { k: 'Approvals', v: s.approvals },
    { k: 'Changes', v: s.changesRequested },
    { k: 'Filings', v: s.filings },
    { k: 'Case notes', v: s.caseNotes },
    { k: 'Wins', v: s.wins },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
      {tiles.map((t) => (
        <div
          key={t.k}
          style={{ padding: '12px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)' }}
        >
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--sos-text-primary)' }}>{t.v}</div>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sos-text-muted)', marginTop: 2 }}>
            {t.k}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice recorder — mirrors the matter NotesPanel VoiceComposer
// ---------------------------------------------------------------------------
function VoiceRecorder({ onRecorded, disabled }: { onRecorded: (blob: Blob) => void; disabled: boolean }) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startingRef = useRef(false);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (recording || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
      const mimeType = candidates.find((c) => MediaRecorder.isTypeSupported(c));
      if (!mimeType) {
        stream.getTracks().forEach((t) => t.stop());
        setError('Your browser cannot record audio. Try Chrome, Firefox, or Safari.');
        return;
      }
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const recorded = new Blob(chunksRef.current, { type: mr.mimeType });
        setRecording(false);
        onRecorded(recorded);
      };
      mr.start(250);
      mediaRecorderRef.current = mr;
      setRecording(true);
      setSecs(0);
      timerRef.current = setInterval(() => {
        setSecs((s) => {
          const next = s + 1;
          if (next >= 120) stopRecording();
          return next;
        });
      }, 1000);
    } catch {
      setError('Microphone access denied. Allow microphone in your browser settings.');
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [recording, stopRecording, onRecorded]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      const mr = mediaRecorderRef.current;
      if (mr) {
        mr.onstop = null;
        mr.stream?.getTracks().forEach((t) => t.stop());
        try {
          mr.stop();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {recording ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e53e3e', animation: 'pulse 1s ease-in-out infinite' }} />
          <span style={{ fontSize: 14, color: 'var(--sos-text-primary)' }}>{fmt(secs)}</span>
          <span style={{ fontSize: 12, color: 'var(--sos-text-muted)', flex: 1 }}>Recording…</span>
          <PrimaryButton type="button" onClick={stopRecording} iconLeft={<Square size={13} />}>
            Stop & save
          </PrimaryButton>
        </div>
      ) : (
        <div>
          <SecondaryButton
            type="button"
            onClick={startRecording}
            disabled={disabled || starting}
            iconLeft={starting ? <Loader2 size={14} className="sos-spin" /> : <Mic size={14} />}
          >
            {starting ? 'Starting…' : 'Record voice note'}
          </SecondaryButton>
        </div>
      )}
      {error ? <div style={{ fontSize: 11.5, color: 'var(--sos-status-danger)' }}>{error}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Email modal (Head only — jr.report.share)
// ---------------------------------------------------------------------------
function EmailModal({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const [emails, setEmails] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);

  async function send() {
    if (sending) return;
    setSending(true);
    setError(null);
    const list = emails.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean);
    try {
      const res = await emailWorkReport(reportId, {
        ...(list.length ? { emails: list } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setDone(res.recipients);
    } catch (e: unknown) {
      setError(errMessage(e));
      setSending(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => e.target === e.currentTarget && !sending && onClose()}
    >
      <GlassCard variant="strong" padded="lg" style={{ width: '100%', maxWidth: 480 }}>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={sending}
          style={{ position: 'absolute', top: 16, right: 16, background: 'transparent', border: 'none', color: 'var(--sos-text-muted)', cursor: 'pointer', padding: 6 }}
        >
          <X size={16} />
        </button>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: 4 }}>Email this report</div>
        <div style={{ fontSize: 13, color: 'var(--sos-text-muted)', marginBottom: 16 }}>
          The branded PDF is attached. Leave recipients blank to send it to yourself.
        </div>

        {done ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sos-status-success)', fontSize: 13.5 }}>
              <CheckCircle2 size={16} /> Sent to {done.join(', ')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <PrimaryButton type="button" onClick={onClose}>Done</PrimaryButton>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FormInput
              label="Recipients"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="comma or space separated (optional)"
            />
            <FormTextarea
              label="Covering note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
            />
            {error ? <div style={{ fontSize: 12, color: 'var(--sos-status-danger)' }}>{error}</div> : null}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <SecondaryButton type="button" onClick={onClose} disabled={sending}>Cancel</SecondaryButton>
              <PrimaryButton
                type="button"
                onClick={send}
                disabled={sending}
                iconLeft={sending ? <Loader2 size={14} className="sos-spin" /> : <Send size={14} />}
              >
                {sending ? 'Sending…' : 'Send'}
              </PrimaryButton>
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function JrReportDetailPage() {
  const params = useParams<{ reportId: string }>();
  const reportId = params.reportId;
  const { user } = useJrSession();
  const canAct = user.permissions.includes('jr.report.generate');
  const canShare = user.permissions.includes('jr.report.share');

  const [data, setData] = useState<HydratedWorkReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchWorkReport(reportId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errMessage(e));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reportId, reloadKey]);

  // Mint signed URLs for image attachments (never embedded; fetched on demand).
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    const images = data.attachments.filter((a) => a.kind === 'IMAGE');
    Promise.all(
      images.map((a) =>
        reportAttachmentSignedUrl(reportId, a.id)
          .then((r) => [a.id, r.url] as const)
          .catch(() => [a.id, ''] as const),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setImageUrls(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [data, reportId]);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (e: unknown) {
      setActionError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--sos-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Loader2 size={16} className="sos-spin" /> Loading report…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Link href={'/jr/reports' as Route} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}>
          <ArrowLeft size={14} /> Back to reports
        </Link>
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{error ?? 'Report not found'}</div>
        </GlassCard>
      </div>
    );
  }

  const { report, body, notes, attachments } = data;
  const isDraft = report.status === 'DRAFT';
  const editable = isDraft && canAct;
  const voices = attachments.filter((a) => a.kind === 'VOICE_NOTE');
  const images = attachments.filter((a) => a.kind === 'IMAGE');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Link href={'/jr/reports' as Route} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}>
        <ArrowLeft size={14} /> Back to reports
      </Link>

      <PageHeader
        eyebrow={report.subjectName ?? 'JR associate'}
        title={`${jrFmtDate(report.periodFrom)} — ${jrFmtDate(report.periodTo)}`}
        description={
          isDraft
            ? 'Live draft — figures recompute on every open until you finalize.'
            : `Finalized snapshot as of ${jrFmtDate(report.updatedAt)} — read-only.`
        }
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusBadge tone={workReportStatusTone(report.status)} size="md">
              {isDraft ? 'Draft' : 'Finalized'}
            </StatusBadge>
            <SecondaryButton type="button" onClick={() => openWorkReportPdf(reportId).catch(() => {})} iconLeft={<Download size={14} />}>
              Download PDF
            </SecondaryButton>
            {canShare ? (
              <SecondaryButton type="button" onClick={() => setEmailOpen(true)} iconLeft={<Mail size={14} />}>
                Email
              </SecondaryButton>
            ) : null}
            {editable ? (
              <PrimaryButton
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await finalizeWorkReport(reportId);
                  })
                }
                iconLeft={busy ? <Loader2 size={14} className="sos-spin" /> : <Lock size={14} />}
              >
                Finalize
              </PrimaryButton>
            ) : null}
          </div>
        }
      />

      {actionError ? (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>
          {actionError}
        </div>
      ) : null}

      {emailOpen ? <EmailModal reportId={reportId} onClose={() => setEmailOpen(false)} /> : null}

      {/* Summary */}
      <GlassCard variant="panel" padded="md">
        <div style={SECTION}>Summary</div>
        {body.hasActivity ? null : (
          <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginBottom: 10 }}>
            No work was recorded for this associate in this period.
          </div>
        )}
        <SummaryTiles body={body} />
      </GlassCard>

      {/* Matters */}
      <GlassCard variant="panel" padded="md">
        <div style={SECTION}>Matters</div>
        {body.matters.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>No matters credited in this period.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 640 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '150px 2fr 130px 80px 70px', gap: 12, padding: '6px 8px', fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
                <span>Matter</span>
                <span>Client / cause</span>
                <span>Stage</span>
                <span style={{ textAlign: 'right' }}>Drafts</span>
                <span style={{ textAlign: 'center' }}>Win</span>
              </div>
              {body.matters.map((m) => (
                <div key={m.matterId} style={{ display: 'grid', gridTemplateColumns: '150px 2fr 130px 80px 70px', gap: 12, padding: '10px 8px', alignItems: 'center', borderBottom: '1px solid var(--sos-border-subtle)', fontSize: 12.5, color: 'var(--sos-text-primary)' }}>
                  <Link href={`/jr/matters/${m.matterId}` as Route} style={{ color: 'var(--sos-brand-primary-strong)', textDecoration: 'none', fontWeight: 600 }}>
                    {m.matterNumber ?? '—'}
                  </Link>
                  <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.clientName ?? m.styleOfCause ?? '—'}
                  </span>
                  <span style={{ color: 'var(--sos-text-secondary)' }}>{jrHumanize(m.stage)}</span>
                  <span style={{ textAlign: 'right' }}>{m.draftVersions}</span>
                  <span style={{ textAlign: 'center' }}>
                    {m.isWin ? <StatusBadge tone="success" size="sm">Win</StatusBadge> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassCard>

      {/* Case notes + deadlines */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <GlassCard variant="panel" padded="md">
          <div style={SECTION}>Case-workspace notes</div>
          {body.caseNotes.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>No case notes in this period.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {body.caseNotes.map((n) => (
                <div key={n.id} style={{ padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                    <StatusBadge tone="info" size="sm" dot={false}>{jrHumanize(n.noteType)}</StatusBadge>
                    <span style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{jrFmtDate(n.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--sos-text-primary)', whiteSpace: 'pre-wrap' }}>{n.content}</div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard variant="panel" padded="md">
          <div style={SECTION}>Deadlines (matter-level)</div>
          {body.deadlines.items.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>No deadlines on the caseload matters.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {body.deadlines.items.map((d, i) => (
                <div key={`${d.matterId}-${d.milestoneKey}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)' }}>
                  <span style={{ fontSize: 12, color: 'var(--sos-text-primary)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.label ?? jrHumanize(d.milestoneKey)}
                    {d.isFatal ? <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: 'var(--sos-status-danger)' }}>FATAL</span> : null}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>{jrFmtDate(d.computedDueAt)}</span>
                  <StatusBadge tone={d.status === 'MET' ? 'success' : d.status === 'MISSED' ? 'danger' : 'info'} size="sm">
                    {jrHumanize(d.status)}
                  </StatusBadge>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginTop: 2 }}>
                On-time {body.deadlines.onTime} · Missed {body.deadlines.missed} · Pending {body.deadlines.pending}
              </div>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Enrichments — report notes */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <NotebookPen size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Report notes</div>
        </div>

        {editable ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            <FormTextarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="Add a cross-client narrative note for this report…"
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <PrimaryButton
                type="button"
                disabled={busy || !noteText.trim()}
                onClick={() =>
                  run(async () => {
                    await addReportNote(reportId, noteText.trim());
                    setNoteText('');
                  })
                }
                iconLeft={busy ? <Loader2 size={14} className="sos-spin" /> : <Send size={14} />}
              >
                Add note
              </PrimaryButton>
            </div>
          </div>
        ) : null}

        {notes.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>No report notes.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notes.map((n) => (
              <div key={n.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--sos-text-primary)', whiteSpace: 'pre-wrap' }}>{n.content}</div>
                  <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginTop: 3 }}>{jrFmtDate(n.createdAt)}</div>
                </div>
                {editable ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => deleteReportNote(reportId, n.id))}
                    aria-label="Delete note"
                    style={{ all: 'unset', cursor: busy ? 'default' : 'pointer', color: 'var(--sos-status-danger)', padding: 4 }}
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Enrichments — attachments */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <ImageIcon size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Images & voice notes</div>
        </div>

        {editable ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)', marginBottom: 16 }}>
            <ImageUploader reportId={reportId} disabled={busy} onUploaded={reload} onError={setActionError} />
            <VoiceRecorder
              disabled={busy}
              onRecorded={(blob) =>
                run(async () => {
                  const ext = extForMime(blob.type);
                  await uploadReportVoice(reportId, blob, `voice-note.${ext}`);
                })
              }
            />
          </div>
        ) : null}

        {attachments.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>No attachments.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {images.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {images.map((a) => (
                  <AttachmentImage
                    key={a.id}
                    att={a}
                    url={imageUrls[a.id]}
                    canDelete={editable}
                    busy={busy}
                    onDelete={() => run(() => deleteReportAttachment(reportId, a.id))}
                  />
                ))}
              </div>
            ) : null}
            {voices.map((a) => (
              <VoiceTranscript
                key={a.id}
                att={a}
                canDelete={editable}
                busy={busy}
                onDelete={() => run(() => deleteReportAttachment(reportId, a.id))}
              />
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image uploader (file picker + clipboard paste) — DRAFT only
// ---------------------------------------------------------------------------
function ImageUploader({
  reportId,
  disabled,
  onUploaded,
  onError,
}: {
  reportId: string;
  disabled: boolean;
  onUploaded: () => void;
  onError: (msg: string) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (file: File) => {
      if (uploading) return;
      setUploading(true);
      try {
        await uploadReportImage(reportId, file, file.name || 'image.png');
        onUploaded();
      } catch (e: unknown) {
        onError(errMessage(e));
      } finally {
        setUploading(false);
      }
    },
    [reportId, uploading, onUploaded, onError],
  );

  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        void upload(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [disabled, upload]);

  return (
    <div>
      <label className="sos-label">Attach an image</label>
      <input
        type="file"
        className="sos-input"
        accept="image/*"
        disabled={disabled || uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
        style={{ paddingTop: 7 }}
      />
      <div className="sos-help">
        {uploading ? 'Uploading…' : 'You can also paste an image from the clipboard.'}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A single image attachment (signed-URL preview + optional delete)
// ---------------------------------------------------------------------------
function AttachmentImage({
  att,
  url,
  canDelete,
  busy,
  onDelete,
}: {
  att: WorkReportAttachment;
  url: string | undefined;
  canDelete: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <div style={{ position: 'relative' }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="attachment"
          onClick={() => url && window.open(url, '_blank', 'noopener')}
          style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', cursor: 'pointer' }}
        />
      ) : (
        <div style={{ width: 120, height: 120, display: 'grid', placeItems: 'center', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-2)', fontSize: 11, color: 'var(--sos-text-muted)' }}>
          <Loader2 size={14} className="sos-spin" />
        </div>
      )}
      {canDelete ? (
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          aria-label="Delete image"
          style={{ all: 'unset', position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--sos-status-danger)', color: '#fff', display: 'grid', placeItems: 'center', cursor: busy ? 'default' : 'pointer' }}
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A single voice-note transcript row
// ---------------------------------------------------------------------------
function VoiceTranscript({
  att,
  canDelete,
  busy,
  onDelete,
}: {
  att: WorkReportAttachment;
  canDelete: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  const text =
    att.transcriptStatus === 'DONE' && att.transcript
      ? att.transcript
      : att.transcriptStatus === 'FAILED'
        ? 'Transcript unavailable.'
        : 'Transcript pending…';
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)' }}>
      <Mic size={15} style={{ color: 'var(--sos-text-muted)', flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sos-text-muted)', marginBottom: 3 }}>
          Voice note — Roman-Urdu transcript
        </div>
        <div style={{ fontSize: 12.5, color: att.transcript ? 'var(--sos-text-primary)' : 'var(--sos-text-muted)', fontStyle: att.transcript ? 'normal' : 'italic', whiteSpace: 'pre-wrap' }}>
          {text}
        </div>
      </div>
      {canDelete ? (
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          aria-label="Delete voice note"
          style={{ all: 'unset', cursor: busy ? 'default' : 'pointer', color: 'var(--sos-status-danger)', padding: 4 }}
        >
          <Trash2 size={14} />
        </button>
      ) : null}
    </div>
  );
}
