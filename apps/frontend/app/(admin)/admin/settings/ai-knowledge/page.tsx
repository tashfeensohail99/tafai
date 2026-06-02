'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import {
  Field,
  FormInput,
  GhostButton,
  GlassCard,
  PageHeader,
  PrimaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  createKnowledge,
  deleteKnowledge,
  listKnowledge,
  updateKnowledge,
  type AiKnowledgeEntry,
  type KnowledgeInput,
} from '@/lib/api-keys';

/**
 * Admin → Settings → Bot Knowledge. CRUD over the RAG knowledge base the
 * WhatsApp AI bot answers from. Each save is embedded server-side and used by
 * the bot within seconds. With strict grounding ON, the bot can only answer
 * what's curated here — so this is the lever for "make the bot helpful" while
 * the gate caps "make the bot safe".
 */
export default function AiKnowledgePage() {
  const [rows, setRows] = useState<AiKnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AiKnowledgeEntry | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listKnowledge(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load knowledge');
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search-as-you-type.
  useEffect(() => {
    const t = setTimeout(() => void reload(search.trim() || undefined), 300);
    return () => clearTimeout(t);
  }, [search, reload]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this knowledge entry? The bot will stop using it immediately.')) return;
    setBusyId(id);
    setError(null);
    try {
      await deleteKnowledge(id);
      setNotice('Entry deleted.');
      await reload(search.trim() || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete entry');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Settings · AI"
        title="Bot Knowledge"
        description="The facts the WhatsApp AI bot answers from. Add or correct entries here — each is embedded on save and used within seconds. With strict grounding on, the bot only answers questions it can match here; anything else it clarifies or books a call. Keep answers short, factual and unambiguous — negations help (e.g. “C11 is NOT a skilled-worker visa; it is an entrepreneur / owner-operator work permit”)."
        actions={
          <>
            <GhostButton iconLeft={<RefreshCw size={14} />} onClick={() => void reload(search.trim() || undefined)}>
              Refresh
            </GhostButton>
            <PrimaryButton iconLeft={<Plus size={14} />} onClick={() => setEditing('new')}>
              Add entry
            </PrimaryButton>
          </>
        }
      />

      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={14} /> {error}
        </div>
      ) : null}
      {notice && !error ? (
        <div className="sos-banner sos-banner--success" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <CheckCircle2 size={14} /> {notice}
        </div>
      ) : null}

      <div style={{ position: 'relative', maxWidth: 420 }}>
        <Search
          size={15}
          style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--sos-text-muted)' }}
        />
        <input
          className="sos-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search question, answer, or program…"
          style={{ width: '100%', paddingLeft: 34 }}
        />
      </div>

      <GlassCard variant="default" padded="lg">
        {loading ? (
          <div className="sos-text-muted" style={{ fontSize: 13, padding: 8 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="sos-text-muted" style={{ fontSize: 13, padding: 8 }}>
            {search ? 'No entries match your search.' : 'No knowledge entries yet. Click “Add entry” to teach the bot a fact.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="sos-text-faint" style={{ fontSize: 11.5 }}>
              {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
            </div>
            {rows.map((row) => (
              <KnowledgeRow
                key={row.id}
                row={row}
                busy={busyId === row.id}
                onEdit={() => setEditing(row)}
                onDelete={() => void handleDelete(row.id)}
              />
            ))}
          </div>
        )}
      </GlassCard>

      {editing ? (
        <KnowledgeModal
          entry={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice('Saved — the bot will use it within seconds.');
            void reload(search.trim() || undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function KnowledgeRow({
  row,
  busy,
  onEdit,
  onDelete,
}: {
  row: AiKnowledgeEntry;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
          <strong style={{ fontSize: 13, color: 'var(--sos-text-primary)' }}>{row.queryEn || '(no question)'}</strong>
          {row.programKey ? <StatusBadge tone="neutral" size="sm" dot={false}>{row.programKey}</StatusBadge> : null}
          <StatusBadge tone={row.sourceFile === 'admin' ? 'success' : 'neutral'} size="sm" dot={false}>
            {row.sourceFile === 'admin' ? 'curated' : row.sourceFile}
          </StatusBadge>
        </div>
        <div className="sos-text-secondary" style={{ fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{row.answerEn}</div>
        {row.answerUr ? (
          <div className="sos-text-muted" style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginTop: 4 }}>UR: {row.answerUr}</div>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <GhostButton size="sm" iconLeft={<Pencil size={13} />} onClick={onEdit} disabled={busy}>Edit</GhostButton>
        <GhostButton
          size="sm"
          iconLeft={busy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={13} />}
          onClick={onDelete}
          disabled={busy}
        >
          Delete
        </GhostButton>
      </div>
    </div>
  );
}

function KnowledgeModal({
  entry,
  onClose,
  onSaved,
}: {
  entry: AiKnowledgeEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [queryEn, setQueryEn] = useState(entry?.queryEn ?? '');
  const [answerEn, setAnswerEn] = useState(entry?.answerEn ?? '');
  const [answerUr, setAnswerUr] = useState(entry?.answerUr ?? '');
  const [programKey, setProgramKey] = useState(entry?.programKey ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (queryEn.trim().length < 3 || answerEn.trim().length < 3) {
      setError('Question and English answer are both required (min 3 characters).');
      return;
    }
    setSubmitting(true);
    setError(null);
    const input: KnowledgeInput = {
      queryEn: queryEn.trim(),
      answerEn: answerEn.trim(),
      answerUr: answerUr.trim() || undefined,
      programKey: programKey.trim() || undefined,
    };
    try {
      if (entry) await updateKnowledge(entry.id, input);
      else await createKnowledge(input);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save entry');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 20 }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 620,
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--sos-surface-0)',
          borderRadius: 'var(--sos-radius-lg)',
          padding: 24,
          border: '1px solid var(--sos-border-subtle)',
        }}
      >
        <h2 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-lg)' }}>
          {entry ? 'Edit entry' : 'Add knowledge entry'}
        </h2>
        <p className="sos-text-muted" style={{ fontSize: 13, marginTop: 6 }}>
          Write the question the way a customer might ask it, plus a short, factual answer. It’s embedded on save and used by the bot immediately.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <Field label="Question / topic" hint="How a customer would ask — e.g. “Is C11 a skilled-worker visa?”">
            <FormInput value={queryEn} onChange={(e) => setQueryEn(e.target.value)} placeholder="e.g. What is C11 — is it for skilled workers?" />
          </Field>

          <Field label="Answer (English)" hint="Short, factual, unambiguous. Negations help (“… is NOT …”).">
            <textarea
              className="sos-input"
              value={answerEn}
              onChange={(e) => setAnswerEn(e.target.value)}
              rows={4}
              placeholder="C11 is an entrepreneur / owner-operator work permit — for people starting or running a business in Canada. It is NOT a skilled-worker visa."
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>

          <Field label="Answer (Roman Urdu) — optional" hint="If set, the bot uses this when the customer writes in Urdu.">
            <textarea
              className="sos-input"
              value={answerUr}
              onChange={(e) => setAnswerUr(e.target.value)}
              rows={3}
              placeholder="C11 entrepreneur / business owner ke liye hai — skilled worker visa NAHI hai."
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>

          <Field label="Program tag — optional" hint="Groups the entry, e.g. C11, SUV, LMIA, VISIT.">
            <FormInput value={programKey} onChange={(e) => setProgramKey(e.target.value)} placeholder="e.g. C11" />
          </Field>

          {error ? (
            <div className="sos-banner sos-banner--danger" style={{ display: 'flex', gap: 8 }}>
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <GhostButton size="sm" onClick={onClose} disabled={submitting}>Cancel</GhostButton>
            <PrimaryButton
              size="sm"
              iconLeft={submitting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
              onClick={() => void handleSave()}
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Save entry'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
