'use client';
// History tab — read-only cross-department background for a processing case:
// notes the Sales and Finance teams recorded for this client, plus the full
// call history (with transcripts + recordings). Data: GET /processing/cases/:id/background
// and (on demand) GET /processing/cases/:id/calls/:callId/recording.

import { useEffect, useState, type ReactNode } from 'react';
import {
  Loader2,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Play,
  ChevronDown,
  ChevronRight,
  StickyNote,
} from 'lucide-react';
import {
  GlassCard,
  EmptyState,
  StatusBadge,
  SecondaryButton,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { type MockProcessingCase, fmtRelative } from '@/components/processing/mockData';
import {
  fetchCaseBackground,
  getCaseCallRecordingUrl,
  type CaseBackground,
  type CrossDeptNote,
  type CaseCall,
} from '@/lib/processing';

function fmtDuration(s: number | null): string {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </div>
  );
}

function NoteCard({ note, tone }: { note: CrossDeptNote; tone: BadgeTone }) {
  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <StatusBadge tone={tone} size="sm">{note.label}</StatusBadge>
        {note.author ? <span style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>{note.author}</span> : null}
        {note.at ? <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--sos-text-muted)' }}>{fmtRelative(note.at)}</span> : null}
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--sos-text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
        {note.text}
      </div>
    </GlassCard>
  );
}

function CallRow({ caseId, call }: { caseId: string; call: CaseCall }) {
  const [open, setOpen] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioErr, setAudioErr] = useState<string | null>(null);

  const missed = call.status === 'MISSED' || call.status === 'FAILED';
  const Icon = missed ? PhoneMissed : call.direction === 'OUTBOUND' ? PhoneOutgoing : PhoneIncoming;
  const iconColor = missed
    ? 'var(--sos-status-danger)'
    : call.direction === 'OUTBOUND'
      ? 'var(--sos-brand-primary-strong)'
      : 'var(--sos-status-success)';
  const statusTone: BadgeTone = missed ? 'danger' : call.status === 'ANSWERED' || call.status === 'ENDED' ? 'success' : 'neutral';
  const hasBody = !!call.transcript || call.hasRecording || call.transcriptStatus === 'PENDING';

  async function playRecording() {
    if (audioUrl) return;
    setLoadingAudio(true);
    setAudioErr(null);
    try {
      const { url } = await getCaseCallRecordingUrl(caseId, call.id);
      setAudioUrl(url);
    } catch (e: unknown) {
      setAudioErr(e instanceof Error ? e.message : 'Could not load recording');
    } finally {
      setLoadingAudio(false);
    }
  }

  return (
    <GlassCard variant="default" padded="md">
      <div
        onClick={() => hasBody && setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: hasBody ? 'pointer' : 'default' }}
      >
        <div style={{ color: iconColor, display: 'flex' }}><Icon size={16} /></div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
            {call.direction === 'OUTBOUND' ? 'Outbound' : 'Inbound'} call
          </span>
          <StatusBadge tone={statusTone} size="sm">{call.status}</StatusBadge>
          <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{fmtDuration(call.durationSeconds)}</span>
          {call.rep ? <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>· {call.rep}</span> : null}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--sos-text-muted)' }}>{fmtRelative(call.at)}</span>
        </div>
        {hasBody ? (
          open ? <ChevronDown size={14} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
               : <ChevronRight size={14} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
        ) : null}
      </div>

      {open ? (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--sos-border-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {call.hasRecording ? (
            audioUrl ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio controls src={audioUrl} style={{ width: '100%' }} />
            ) : (
              <div>
                <SecondaryButton
                  iconLeft={loadingAudio ? <Loader2 size={13} className="sos-spin" /> : <Play size={13} />}
                  onClick={playRecording}
                  disabled={loadingAudio}
                >
                  {loadingAudio ? 'Loading…' : 'Play recording'}
                </SecondaryButton>
                {audioErr ? <div style={{ marginTop: 6, fontSize: 12, color: 'var(--sos-status-danger)' }}>{audioErr}</div> : null}
              </div>
            )
          ) : null}

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Transcript
            </div>
            {call.transcript ? (
              <div style={{ fontSize: 13, color: 'var(--sos-text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{call.transcript}</div>
            ) : call.transcriptStatus === 'PENDING' ? (
              <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', fontStyle: 'italic' }}>Transcribing…</div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', fontStyle: 'italic' }}>No transcript available.</div>
            )}
          </div>
        </div>
      ) : null}
    </GlassCard>
  );
}

export function CaseHistoryTab({ c }: { c: MockProcessingCase }) {
  const [data, setData] = useState<CaseBackground | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCaseBackground(c.id)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load history'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [c.id]);

  if (loading) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
          <Loader2 size={16} className="sos-spin" />
          <span>Loading history…</span>
        </div>
      </GlassCard>
    );
  }
  if (err) {
    return (
      <GlassCard variant="panel" padded="md">
        <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>
      </GlassCard>
    );
  }

  const sales = data?.salesNotes ?? [];
  const finance = data?.financeNotes ?? [];
  const calls = data?.calls ?? [];
  const noNotes = sales.length === 0 && finance.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SectionHeader>Sales &amp; Finance notes</SectionHeader>
        {noNotes ? (
          <GlassCard variant="panel" padded="lg">
            <EmptyState
              Icon={StickyNote}
              title="No sales or finance notes"
              description="Notes the Sales and Finance teams recorded for this client appear here, read-only — so you have the full context before processing."
            />
          </GlassCard>
        ) : (
          <>
            {sales.map((n, i) => <NoteCard key={`s${i}`} note={n} tone="accent" />)}
            {finance.map((n, i) => <NoteCard key={`f${i}`} note={n} tone="warm" />)}
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SectionHeader>Call history{calls.length ? ` (${calls.length})` : ''}</SectionHeader>
        {calls.length === 0 ? (
          <GlassCard variant="panel" padded="lg">
            <EmptyState
              Icon={Phone}
              title="No calls"
              description="Inbound and outbound calls with this client — including transcripts and recordings — appear here."
            />
          </GlassCard>
        ) : (
          calls.map((call) => <CallRow key={call.id} caseId={c.id} call={call} />)
        )}
      </div>
    </div>
  );
}
