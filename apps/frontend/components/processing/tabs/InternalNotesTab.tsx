'use client';
// Internal Notes Tab — real backend wiring.
// Pinned notes at top. Type pills (GENERAL / ESCALATION / STRATEGY / etc.)
// Add note form below the list. POSTs to /processing/cases/:id/notes.

import { useEffect, useState } from 'react';
import {
  Loader2,
  Pin,
  PlusCircle,
  StickyNote,
} from 'lucide-react';
import {
  GlassCard,
  EmptyState,
  PrimaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  fmtRelative,
} from '@/components/processing/mockData';
import {
  fetchCaseNotes,
  createCaseNote,
  type ApiProcessingNote,
  type ProcessingNoteType,
} from '@/lib/processing';

function noteTypeTone(type: ProcessingNoteType): BadgeTone {
  switch (type) {
    case 'ESCALATION': return 'danger';
    case 'STRATEGY': return 'violet';
    case 'CLIENT_INSIGHT': return 'cyan';
    case 'AUTHORITY_NOTE': return 'info';
    case 'MANAGER_ONLY': return 'warm';
    default: return 'neutral';
  }
}

function noteTypeLabel(type: ProcessingNoteType): string {
  switch (type) {
    case 'GENERAL': return 'General';
    case 'ESCALATION': return 'Escalation';
    case 'STRATEGY': return 'Strategy';
    case 'CLIENT_INSIGHT': return 'Client insight';
    case 'AUTHORITY_NOTE': return 'Authority note';
    case 'MANAGER_ONLY': return 'Manager only';
    default: return type;
  }
}

function NoteCard({ note }: { note: ApiProcessingNote }) {
  const author = note.createdBy?.email.split('@')[0] ?? 'Officer';
  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
        {note.isPinned ? (
          <Pin size={14} style={{ color: 'var(--sos-brand-accent)', flexShrink: 0, marginTop: '2px' }} />
        ) : (
          <StickyNote size={14} style={{ color: 'var(--sos-text-muted)', flexShrink: 0, marginTop: '2px' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <StatusBadge tone={noteTypeTone(note.noteType)} size="sm" dot={false}>
              {noteTypeLabel(note.noteType)}
            </StatusBadge>
            {note.isPinned ? (
              <StatusBadge tone="warm" size="sm" dot={false}>Pinned</StatusBadge>
            ) : null}
            <span style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginLeft: 'auto' }}>
              {author} · {fmtRelative(note.createdAt)}
            </span>
          </div>
          <div style={{ fontSize: '13.5px', color: 'var(--sos-text-primary)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
            {note.content}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

const NOTE_TYPES: Array<{ value: ProcessingNoteType; label: string }> = [
  { value: 'GENERAL', label: 'General' },
  { value: 'STRATEGY', label: 'Strategy' },
  { value: 'CLIENT_INSIGHT', label: 'Client insight' },
  { value: 'AUTHORITY_NOTE', label: 'Authority note' },
  { value: 'ESCALATION', label: 'Escalation' },
  { value: 'MANAGER_ONLY', label: 'Manager only' },
];

function AddNoteForm({ onSaved, caseId }: { onSaved: (n: ApiProcessingNote) => void; caseId: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ProcessingNoteType>('GENERAL');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    if (!content.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const saved = await createCaseNote(caseId, { content: content.trim(), noteType: type });
      onSaved(saved);
      setContent('');
      setType('GENERAL');
      setOpen(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to save note');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <PrimaryButton iconLeft={<PlusCircle size={14} />} onClick={() => setOpen(true)}>
        Add note
      </PrimaryButton>
    );
  }

  return (
    <GlassCard variant="strong" padded="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Note type</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {NOTE_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                style={{ padding: '4px 12px', borderRadius: 'var(--sos-radius-md)', fontSize: '12.5px', fontWeight: 500, border: `1px solid ${type === t.value ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`, background: type === t.value ? 'var(--sos-brand-primary-soft)' : 'transparent', color: type === t.value ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)', cursor: 'pointer', transition: 'all 150ms' }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Type your note here…"
          rows={4}
          style={{ width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
        {err ? (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>
            {err}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setOpen(false)} style={{ padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: '13px', cursor: 'pointer' }}>
            Cancel
          </button>
          <PrimaryButton onClick={handleSubmit} disabled={saving || !content.trim()}>
            {saving ? 'Saving…' : 'Save note'}
          </PrimaryButton>
        </div>
      </div>
    </GlassCard>
  );
}

export function InternalNotesTab({ c }: { c: MockProcessingCase }) {
  // Real backend wire-up. Fetches /processing/cases/:id/notes on mount,
  // appends new notes after a successful POST.
  const [notes, setNotes] = useState<ApiProcessingNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCaseNotes(c.id)
      .then((rows) => { if (!cancelled) setNotes(rows); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load notes'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [c.id]);

  const pinned = notes.filter((n) => n.isPinned);
  const rest = notes.filter((n) => !n.isPinned);

  function handleSaved(n: ApiProcessingNote) {
    setNotes((prev) => [n, ...prev]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <AddNoteForm caseId={c.id} onSaved={handleSaved} />
      </div>

      {loading ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
            <Loader2 size={16} className="sos-spin" />
            <span>Loading notes…</span>
          </div>
        </GlassCard>
      ) : err ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>
        </GlassCard>
      ) : notes.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={StickyNote}
            title="No notes yet"
            description="Add internal notes visible only to processing staff."
          />
        </GlassCard>
      ) : (
        <>
          {pinned.length > 0 ? (
            <div>
              <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Pin size={12} /> Pinned
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {pinned.map((n) => <NoteCard key={n.id} note={n} />)}
              </div>
            </div>
          ) : null}
          {rest.length > 0 ? (
            <div>
              {pinned.length > 0 ? (
                <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                  All notes
                </div>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {rest.map((n) => <NoteCard key={n.id} note={n} />)}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
