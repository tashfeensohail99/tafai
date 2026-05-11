'use client';
// Internal Notes Tab — Phase 1B.
// Pinned notes at top. Type pills (GENERAL / ESCALATION / STRATEGY / etc.)
// Add note form below the list.

import { useState } from 'react';
import {
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
  type MockNote,
  fmtRelative,
} from '@/components/processing/mockData';

function noteTypeTone(type: MockNote['noteType']): BadgeTone {
  switch (type) {
    case 'ESCALATION': return 'danger';
    case 'STRATEGY': return 'violet';
    case 'CLIENT_INSIGHT': return 'cyan';
    case 'AUTHORITY_NOTE': return 'info';
    case 'MANAGER_ONLY': return 'warm';
    default: return 'neutral';
  }
}

function noteTypeLabel(type: MockNote['noteType']): string {
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

function NoteCard({ note }: { note: MockNote }) {
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
              {note.createdByName} · {fmtRelative(note.createdAt)}
            </span>
          </div>
          <div style={{ fontSize: '13.5px', color: 'var(--sos-text-primary)', lineHeight: 1.65 }}>
            {note.content}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ---------- Add note form -------------------------------------------------

type NoteType = MockNote['noteType'];

const NOTE_TYPES: Array<{ value: NoteType; label: string }> = [
  { value: 'GENERAL', label: 'General' },
  { value: 'STRATEGY', label: 'Strategy' },
  { value: 'CLIENT_INSIGHT', label: 'Client insight' },
  { value: 'AUTHORITY_NOTE', label: 'Authority note' },
  { value: 'ESCALATION', label: 'Escalation' },
];

function AddNoteForm({ onAdd }: { onAdd: (note: MockNote) => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<NoteType>('GENERAL');
  const [content, setContent] = useState('');
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(false);

  function handleSubmit() {
    if (!content.trim()) return;
    setLoading(true);
    setTimeout(() => {
      const newNote: MockNote = {
        id: `note-new-${Date.now()}`,
        content,
        noteType: type,
        isPinned: pinned,
        createdByName: 'Sara Malik',
        createdAt: new Date().toISOString(),
      };
      onAdd(newNote);
      setContent('');
      setPinned(false);
      setType('GENERAL');
      setOpen(false);
      setLoading(false);
    }, 500);
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
        {/* Type selector */}
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

        {/* Content textarea */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Type your note here…"
          rows={4}
          style={{ width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />

        {/* Pin checkbox */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--sos-text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} style={{ accentColor: 'var(--sos-brand-primary-strong)' }} />
          Pin this note to the top
        </label>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setOpen(false)} style={{ padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: '13px', cursor: 'pointer' }}>
            Cancel
          </button>
          <PrimaryButton onClick={handleSubmit} disabled={loading || !content.trim()}>
            {loading ? 'Saving…' : 'Save note'}
          </PrimaryButton>
        </div>
      </div>
    </GlassCard>
  );
}

// ---------- Notes tab component -------------------------------------------

export function InternalNotesTab({ c }: { c: MockProcessingCase }) {
  const [notes, setNotes] = useState<MockNote[]>(c.notes);

  const pinned = notes.filter((n) => n.isPinned);
  const rest = notes.filter((n) => !n.isPinned);

  function handleAdd(note: MockNote) {
    setNotes((prev) => [note, ...prev]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <AddNoteForm onAdd={handleAdd} />
      </div>

      {notes.length === 0 ? (
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
