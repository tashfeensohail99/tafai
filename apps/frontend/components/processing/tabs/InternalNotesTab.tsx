'use client';
// Internal Notes Tab — full management surface for the processing team.
// Create / pin / edit / soft-delete notes, filter by type + search, and
// @mention teammates (who get an in-app notification + email). Pinned first.
// Edit/delete are limited to the author (or a manager) — enforced server-side.

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Pin,
  PinOff,
  PlusCircle,
  StickyNote,
  Search,
  Pencil,
  Trash2,
  AtSign,
  X,
} from 'lucide-react';
import {
  GlassCard,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { type MockProcessingCase, fmtRelative } from '@/components/processing/mockData';
import { useProcessingSession } from '@/components/layout/ProcessingShell';
import {
  fetchCaseNotes,
  createCaseNote,
  updateCaseNote,
  deleteCaseNote,
  pinCaseNote,
  fetchNoteMentionCandidates,
  type ApiProcessingNote,
  type ProcessingNoteType,
  type ApiProcessingOfficer,
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

const NOTE_TYPES: Array<{ value: ProcessingNoteType; label: string }> = [
  { value: 'GENERAL', label: 'General' },
  { value: 'STRATEGY', label: 'Strategy' },
  { value: 'CLIENT_INSIGHT', label: 'Client insight' },
  { value: 'AUTHORITY_NOTE', label: 'Authority note' },
  { value: 'ESCALATION', label: 'Escalation' },
  { value: 'MANAGER_ONLY', label: 'Manager only' },
];

function shortName(email?: string | null): string {
  return email ? email.split('@')[0] : 'Officer';
}

// Toggleable roster of teammates to @mention.
function MentionPicker({
  officers,
  selected,
  onToggle,
}: {
  officers: ApiProcessingOfficer[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (officers.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 5 }}>
        <AtSign size={12} /> Mention teammates
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {officers.map((o) => {
          const on = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onToggle(o.id)}
              style={{ padding: '4px 10px', borderRadius: 999, fontSize: '12px', fontWeight: 500, border: `1px solid ${on ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`, background: on ? 'var(--sos-brand-primary-soft)' : 'transparent', color: on ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)', cursor: 'pointer', transition: 'all 150ms' }}
            >
              {on ? '✓ ' : '@'}{o.name || shortName(o.email)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Shared editor for both "add" and inline "edit".
function NoteEditor({
  officers,
  initialContent = '',
  initialType = 'GENERAL',
  initialMentions = [],
  saving,
  err,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  officers: ApiProcessingOfficer[];
  initialContent?: string;
  initialType?: ProcessingNoteType;
  initialMentions?: string[];
  saving: boolean;
  err: string | null;
  submitLabel: string;
  onSubmit: (v: { content: string; noteType: ProcessingNoteType; mentions: string[] }) => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(initialContent);
  const [type, setType] = useState<ProcessingNoteType>(initialType);
  const [mentions, setMentions] = useState<string[]>(initialMentions);

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
        <MentionPicker officers={officers} selected={mentions} onToggle={(id) => setMentions((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]))} />
        {err ? (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>{err}</div>
        ) : null}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
          <PrimaryButton onClick={() => onSubmit({ content: content.trim(), noteType: type, mentions })} disabled={saving || !content.trim()}>
            {saving ? 'Saving…' : submitLabel}
          </PrimaryButton>
        </div>
      </div>
    </GlassCard>
  );
}

function NoteCard({
  note,
  officers,
  canManage,
  onPin,
  onEdit,
  onDelete,
}: {
  note: ApiProcessingNote;
  officers: ApiProcessingOfficer[];
  canManage: boolean;
  onPin: (n: ApiProcessingNote) => void;
  onEdit: (id: string, v: { content: string; noteType: ProcessingNoteType; mentions: string[] }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const author = shortName(note.createdBy?.email);
  const mentionNames = (note.mentions ?? [])
    .map((id) => officers.find((o) => o.id === id)?.name || null)
    .filter((n): n is string => !!n);

  if (editing) {
    return (
      <NoteEditor
        officers={officers}
        initialContent={note.content}
        initialType={note.noteType}
        initialMentions={note.mentions ?? []}
        saving={busy}
        err={err}
        submitLabel="Save changes"
        onCancel={() => { setEditing(false); setErr(null); }}
        onSubmit={async (v) => {
          setBusy(true); setErr(null);
          try { await onEdit(note.id, v); setEditing(false); }
          catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Failed to save'); }
          finally { setBusy(false); }
        }}
      />
    );
  }

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
            <StatusBadge tone={noteTypeTone(note.noteType)} size="sm" dot={false}>{noteTypeLabel(note.noteType)}</StatusBadge>
            {note.isPinned ? <StatusBadge tone="warm" size="sm" dot={false}>Pinned</StatusBadge> : null}
            <span style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginLeft: 'auto' }}>
              {author} · {fmtRelative(note.createdAt)}{note.editedAt ? ' · edited' : ''}
            </span>
          </div>
          <div style={{ fontSize: '13.5px', color: 'var(--sos-text-primary)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
            {note.content}
          </div>
          {mentionNames.length > 0 ? (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {mentionNames.map((n, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 600, color: 'var(--sos-brand-primary-strong)', background: 'var(--sos-brand-primary-soft)', padding: '1px 7px', borderRadius: 999 }}>
                  <AtSign size={10} />{n}
                </span>
              ))}
            </div>
          ) : null}

          {/* Actions */}
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <SecondaryButton iconLeft={note.isPinned ? <PinOff size={13} /> : <Pin size={13} />} onClick={() => onPin(note)}>
              {note.isPinned ? 'Unpin' : 'Pin'}
            </SecondaryButton>
            {canManage ? (
              <>
                <SecondaryButton iconLeft={<Pencil size={13} />} onClick={() => { setEditing(true); setErr(null); }}>Edit</SecondaryButton>
                {confirmDel ? (
                  <>
                    <PrimaryButton onClick={async () => { setBusy(true); try { await onDelete(note.id); } finally { setBusy(false); } }} disabled={busy}>
                      {busy ? 'Deleting…' : 'Confirm delete'}
                    </PrimaryButton>
                    <button type="button" onClick={() => setConfirmDel(false)} style={{ padding: '6px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
                  </>
                ) : (
                  <SecondaryButton iconLeft={<Trash2 size={13} />} onClick={() => setConfirmDel(true)}>Delete</SecondaryButton>
                )}
              </>
            ) : null}
          </div>
          {err ? <div style={{ marginTop: 6, fontSize: 12, color: 'var(--sos-status-danger)' }}>{err}</div> : null}
        </div>
      </div>
    </GlassCard>
  );
}

function AddNote({ officers, onSaved, caseId }: { officers: ApiProcessingOfficer[]; onSaved: (n: ApiProcessingNote) => void; caseId: string }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <PrimaryButton iconLeft={<PlusCircle size={14} />} onClick={() => setOpen(true)}>Add note</PrimaryButton>
    );
  }
  return (
    <NoteEditor
      officers={officers}
      saving={saving}
      err={err}
      submitLabel="Save note"
      onCancel={() => { setOpen(false); setErr(null); }}
      onSubmit={async (v) => {
        setSaving(true); setErr(null);
        try {
          const saved = await createCaseNote(caseId, v);
          onSaved(saved);
          setOpen(false);
        } catch (e: unknown) {
          setErr(e instanceof Error ? e.message : 'Failed to save note');
        } finally {
          setSaving(false);
        }
      }}
    />
  );
}

export function InternalNotesTab({ c }: { c: MockProcessingCase }) {
  const { user } = useProcessingSession();
  const isManager = user.permissions.includes('processing.note.view_all') || user.permissions.includes('processing.case.view_all');

  const [notes, setNotes] = useState<ApiProcessingNote[]>([]);
  const [officers, setOfficers] = useState<ApiProcessingOfficer[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | ProcessingNoteType>('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchCaseNotes(c.id)
      .then((rows) => { if (!cancelled) setNotes(rows); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load notes'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    // Mention candidates — best-effort; the feature degrades gracefully if absent.
    fetchNoteMentionCandidates()
      .then((rows) => { if (!cancelled) setOfficers(rows); })
      .catch(() => { /* mentions just won't be offered */ });
    return () => { cancelled = true; };
  }, [c.id]);

  function canManage(n: ApiProcessingNote): boolean {
    return (n.createdBy?.id ?? n.createdByUserId) === user.id || isManager;
  }

  async function handlePin(n: ApiProcessingNote) {
    // optimistic flip
    setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, isPinned: !x.isPinned } : x)));
    try {
      const updated = await pinCaseNote(c.id, n.id, { isPinned: !n.isPinned });
      setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, ...updated } : x)));
    } catch {
      setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, isPinned: n.isPinned } : x))); // revert
    }
  }
  async function handleEdit(id: string, v: { content: string; noteType: ProcessingNoteType; mentions: string[] }) {
    const updated = await updateCaseNote(c.id, id, v);
    setNotes((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated } : x)));
  }
  async function handleDelete(id: string) {
    await deleteCaseNote(c.id, id);
    setNotes((prev) => prev.filter((x) => x.id !== id));
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (filterType !== 'ALL' && n.noteType !== filterType) return false;
      if (q && !n.content.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [notes, filterType, search]);

  const pinned = visible.filter((n) => n.isPinned);
  const rest = visible.filter((n) => !n.isPinned);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <AddNote caseId={c.id} officers={officers} onSaved={(n) => setNotes((prev) => [n, ...prev])} />
      </div>

      {/* Filter + search */}
      {notes.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {(['ALL', ...NOTE_TYPES.map((t) => t.value)] as Array<'ALL' | ProcessingNoteType>).map((t) => {
              const on = filterType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFilterType(t)}
                  style={{ padding: '3px 10px', borderRadius: 999, fontSize: '11.5px', fontWeight: 500, border: `1px solid ${on ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`, background: on ? 'var(--sos-brand-primary-soft)' : 'transparent', color: on ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)', cursor: 'pointer' }}
                >
                  {t === 'ALL' ? 'All' : noteTypeLabel(t)}
                </button>
              );
            })}
          </div>
          <div style={{ marginLeft: 'auto', position: 'relative', minWidth: 180 }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--sos-text-muted)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes…"
              style={{ width: '100%', padding: '6px 10px 6px 28px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            />
            {search ? (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--sos-text-muted)', cursor: 'pointer', display: 'flex' }}>
                <X size={13} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

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
          <EmptyState Icon={StickyNote} title="No notes yet" description="Add internal notes visible only to processing staff. @mention a teammate to loop them in." />
        </GlassCard>
      ) : visible.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState Icon={Search} title="No matching notes" description="No notes match the current filter or search." />
        </GlassCard>
      ) : (
        <>
          {pinned.length > 0 ? (
            <div>
              <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Pin size={12} /> Pinned
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {pinned.map((n) => <NoteCard key={n.id} note={n} officers={officers} canManage={canManage(n)} onPin={handlePin} onEdit={handleEdit} onDelete={handleDelete} />)}
              </div>
            </div>
          ) : null}
          {rest.length > 0 ? (
            <div>
              {pinned.length > 0 ? (
                <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>All notes</div>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {rest.map((n) => <NoteCard key={n.id} note={n} officers={officers} canManage={canManage(n)} onPin={handlePin} onEdit={handleEdit} onDelete={handleDelete} />)}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
