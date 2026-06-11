'use client';

/**
 * Quick-reply picker for the WhatsApp composer. Lists Team (admin-managed)
 * and Mine (personal) snippets; clicking one inserts it into the typing box
 * (the caller substitutes {{name}} and appends — nothing auto-sends).
 * Creation/edit/delete happen inline so reps never leave the chat.
 */
import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import {
  createQuickReply,
  deleteQuickReply,
  listQuickReplies,
  updateQuickReply,
  type QuickReply,
  type QuickReplyList,
} from '@/lib/quick-replies';

export function QuickReplyPicker(props: {
  open: boolean;
  onClose: () => void;
  /** Insert the (already {{name}}-filled) snippet into the composer. */
  onInsert: (body: string) => void;
}) {
  const { open, onClose, onInsert } = props;
  const [data, setData] = useState<QuickReplyList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline editor state: null = list mode; 'new' = creating; else editing id.
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [asTeam, setAsTeam] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setLoading(true);
    setError(null);
    listQuickReplies()
      .then(setData)
      .catch(() => setError('Could not load quick replies.'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const startNew = () => {
    setTitle('');
    setBody('');
    setAsTeam(false);
    setEditing('new');
  };

  const startEdit = (qr: QuickReply) => {
    setTitle(qr.title);
    setBody(qr.body);
    setAsTeam(qr.ownerUserId === null);
    setEditing(qr.id);
  };

  const save = async () => {
    if (!title.trim() || !body.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (editing === 'new') {
        await createQuickReply({ title: title.trim(), body: body.trim(), team: asTeam });
      } else if (editing) {
        await updateQuickReply(editing, { title: title.trim(), body: body.trim() });
      }
      setData(await listQuickReplies());
      setEditing(null);
    } catch {
      setError('Could not save. Team snippets need template-manager access.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteQuickReply(id);
      setData(await listQuickReplies());
    } catch {
      setError('Could not delete.');
    }
  };

  const section = (label: string, rows: QuickReply[], editable: boolean) => (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: 'var(--sos-text-muted)',
          padding: '4px 6px',
        }}
      >
        {label}
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', padding: '2px 6px' }}>
          None yet.
        </div>
      ) : (
        rows.map((qr) => (
          <div
            key={qr.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
              borderRadius: 8,
              padding: '6px 6px',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.06)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'transparent';
            }}
          >
            <button
              type="button"
              onClick={() => {
                onInsert(qr.body);
                onClose();
              }}
              style={{
                all: 'unset',
                cursor: 'pointer',
                flex: 1,
                minWidth: 0,
              }}
              title="Insert into message"
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--sos-text-primary)',
                }}
              >
                {qr.title}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--sos-text-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 280,
                }}
              >
                {qr.body}
              </div>
            </button>
            {editable ? (
              <>
                <button
                  type="button"
                  title="Edit"
                  onClick={() => startEdit(qr)}
                  style={{ all: 'unset', cursor: 'pointer', color: 'var(--sos-text-muted)', padding: 4 }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  title="Delete"
                  onClick={() => void remove(qr.id)}
                  style={{ all: 'unset', cursor: 'pointer', color: 'var(--sos-text-muted)', padding: 4 }}
                >
                  <Trash2 size={14} />
                </button>
              </>
            ) : null}
          </div>
        ))
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Quick replies" width={460}>
      <div style={{ padding: 14, maxHeight: '62vh', overflowY: 'auto' }}>
        {editing === null ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
            <button
              type="button"
              onClick={startNew}
              style={{
                all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center',
                gap: 4, fontSize: 12, color: 'var(--wa-accent)', fontWeight: 600,
              }}
            >
              <Plus size={14} /> New quick reply
            </button>
          </div>
        ) : null}

        {error ? (
          <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{error}</div>
        ) : null}

        {editing !== null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short title (e.g. Office address)"
              style={{
                background: 'var(--wa-composer-input-bg)', color: 'var(--sos-text-primary)',
                border: '1px solid var(--sos-border-subtle)', borderRadius: 8,
                padding: '8px 10px', fontSize: 13, outline: 'none',
              }}
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={'The message text. Use {{name}} for the customer’s first name.'}
              rows={4}
              style={{
                background: 'var(--wa-composer-input-bg)', color: 'var(--sos-text-primary)',
                border: '1px solid var(--sos-border-subtle)', borderRadius: 8,
                padding: '8px 10px', fontSize: 13, outline: 'none', resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
            {editing === 'new' && data?.canManageTeam ? (
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, color: 'var(--sos-text-muted)', cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={asTeam}
                  onChange={(e) => setAsTeam(e.target.checked)}
                />
                Share with the whole team
              </label>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setEditing(null)}
                style={{
                  all: 'unset', cursor: 'pointer', fontSize: 13,
                  color: 'var(--sos-text-muted)', padding: '6px 10px',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !title.trim() || !body.trim()}
                style={{
                  all: 'unset', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  background: 'var(--wa-accent)', color: '#fff', borderRadius: 8,
                  padding: '6px 14px', opacity: saving || !title.trim() || !body.trim() ? 0.5 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : loading ? (
          <div style={{ fontSize: 13, color: 'var(--sos-text-muted)', padding: 8 }}>Loading…</div>
        ) : data ? (
          <>
            {section('Team', data.team, data.canManageTeam)}
            {section('Mine', data.mine, true)}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
