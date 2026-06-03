'use client';
// Corrections Tab — wired to /processing/cases/:id/corrections.
// Lists open + resolved correction requests. Officers can create new ones,
// resolve them once the client responds, or escalate to a manager.

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  ClipboardEdit,
  Loader2,
  PlusCircle,
} from 'lucide-react';
import {
  GlassCard,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  fmtRelative,
} from '@/components/processing/mockData';
import {
  fetchCaseCorrections,
  createCaseCorrection,
  resolveCaseCorrection,
  escalateCaseCorrection,
  type ApiCorrectionRequest,
  type CorrectionStatus,
  type CorrectionRequiredAction,
} from '@/lib/processing';

const STATUS_TONE: Record<CorrectionStatus, BadgeTone> = {
  SENT: 'info',
  IN_PROGRESS: 'accent',
  RESOLVED: 'success',
  ESCALATED: 'danger',
};

const STATUS_LABEL: Record<CorrectionStatus, string> = {
  SENT: 'Sent',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  ESCALATED: 'Escalated',
};

const ACTION_LABEL: Record<CorrectionRequiredAction, string> = {
  REUPLOAD: 'Re-upload',
  CONFIRM: 'Confirm',
  CORRECT: 'Correct',
  CALL_BACK: 'Call back',
};

function CorrectionCard({
  cr,
  onResolve,
  onEscalate,
}: {
  cr: ApiCorrectionRequest;
  onResolve: (id: string, note?: string) => Promise<void>;
  onEscalate: (id: string, reason: string) => Promise<void>;
}) {
  const [showResolve, setShowResolve] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const isOpen = cr.status === 'SENT' || cr.status === 'IN_PROGRESS';

  async function handleResolve() {
    setBusy(true);
    try { await onResolve(cr.id, text.trim() || undefined); setShowResolve(false); setText(''); }
    finally { setBusy(false); }
  }
  async function handleEscalate() {
    if (!text.trim()) return;
    setBusy(true);
    try { await onEscalate(cr.id, text.trim()); setShowEscalate(false); setText(''); }
    finally { setBusy(false); }
  }

  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ marginTop: 2, color: cr.status === 'ESCALATED' ? 'var(--sos-status-danger)' : 'var(--sos-status-warning)' }}>
          <AlertCircle size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{cr.subject}</span>
            <StatusBadge tone={STATUS_TONE[cr.status]} size="sm">{STATUS_LABEL[cr.status]}</StatusBadge>
            <StatusBadge tone="neutral" size="sm">{cr.correctionType}</StatusBadge>
            <StatusBadge tone="warm" size="sm">{ACTION_LABEL[cr.requiredAction]}</StatusBadge>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--sos-text-muted)' }}>{fmtRelative(cr.createdAt)}</span>
          </div>

          <div style={{ fontSize: 13, color: 'var(--sos-text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.55, marginBottom: 6 }}>
            {cr.clientMessage}
          </div>

          {(cr.reasonCodes?.length ?? 0) > 0 ? (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
              {cr.reasonCodes.map((r) => (
                <span key={r} style={{ fontSize: 10.5, padding: '2px 6px', borderRadius: 4, background: 'var(--sos-surface-hover)', color: 'var(--sos-text-muted)' }}>{r}</span>
              ))}
            </div>
          ) : null}

          {cr.officerNote ? (
            <div style={{ marginTop: 4, padding: '8px 12px', borderRadius: 8, background: 'var(--sos-surface-hover)', fontSize: 12, color: 'var(--sos-text-muted)' }}>
              <strong>Officer note:</strong> {cr.officerNote}
            </div>
          ) : null}
          {cr.resolutionNote ? (
            <div style={{ marginTop: 6, padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-success-soft)', border: '1px solid var(--sos-status-success-border)', fontSize: 12.5, color: 'var(--sos-text-primary)' }}>
              <strong>Resolved:</strong> {cr.resolutionNote}
            </div>
          ) : null}
          {cr.escalationReason ? (
            <div style={{ marginTop: 6, padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', fontSize: 12.5, color: 'var(--sos-text-primary)' }}>
              <strong>Escalated:</strong> {cr.escalationReason}
            </div>
          ) : null}

          {isOpen ? (
            <div style={{ marginTop: 10 }}>
              {showResolve ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea
                    rows={2}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Resolution note (optional)"
                    style={{ width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: 13, fontFamily: 'inherit' }}
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => { setShowResolve(false); setText(''); }} style={{ padding: '6px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
                    <PrimaryButton onClick={handleResolve} disabled={busy}>{busy ? 'Saving…' : 'Mark resolved'}</PrimaryButton>
                  </div>
                </div>
              ) : showEscalate ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea
                    rows={2}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Why does this need to escalate to a manager? (required)"
                    style={{ width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: 13, fontFamily: 'inherit' }}
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => { setShowEscalate(false); setText(''); }} style={{ padding: '6px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
                    <PrimaryButton onClick={handleEscalate} disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Escalate'}</PrimaryButton>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <SecondaryButton iconLeft={<CheckCircle2 size={13} />} onClick={() => { setShowResolve(true); setText(''); }}>Resolve</SecondaryButton>
                  <SecondaryButton iconLeft={<ArrowUpCircle size={13} />} onClick={() => { setShowEscalate(true); setText(''); }}>Escalate</SecondaryButton>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </GlassCard>
  );
}

function NewCorrectionForm({ caseId, onCreated }: { caseId: string; onCreated: (cr: ApiCorrectionRequest) => void }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [clientMessage, setClientMessage] = useState('');
  const [requiredAction, setRequiredAction] = useState<CorrectionRequiredAction>('REUPLOAD');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    if (!subject.trim() || !clientMessage.trim() || !reasonCode.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const saved = await createCaseCorrection(caseId, {
        correctionType: 'INFORMATION',
        subject: subject.trim(),
        reasonCodes: reasonCode.split(',').map((s) => s.trim()).filter(Boolean),
        clientMessage: clientMessage.trim(),
        requiredAction,
      });
      onCreated(saved);
      setSubject('');
      setReasonCode('');
      setClientMessage('');
      setRequiredAction('REUPLOAD');
      setOpen(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <PrimaryButton iconLeft={<PlusCircle size={14} />} onClick={() => setOpen(true)}>
        Request correction
      </PrimaryButton>
    );
  }

  return (
    <GlassCard variant="strong" padded="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input className="sos-input" placeholder="Subject (e.g. Passport scan unreadable)" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <input className="sos-input" placeholder="Reason codes (comma-separated, e.g. BLURRY, EXPIRED)" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} />
        <textarea
          rows={4}
          value={clientMessage}
          onChange={(e) => setClientMessage(e.target.value)}
          placeholder="Message to client explaining what to do…"
          style={{ width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Required action</div>
          <select
            className="sos-input"
            value={requiredAction}
            onChange={(e) => setRequiredAction(e.target.value as CorrectionRequiredAction)}
          >
            <option value="REUPLOAD">Re-upload document</option>
            <option value="CONFIRM">Confirm information</option>
            <option value="CORRECT">Correct information</option>
            <option value="CALL_BACK">Call back</option>
          </select>
        </div>
        {err ? (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>{err}</div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setOpen(false)} style={{ padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <PrimaryButton onClick={handleSubmit} disabled={saving || !subject.trim() || !clientMessage.trim() || !reasonCode.trim()}>
            {saving ? 'Saving…' : 'Send correction'}
          </PrimaryButton>
        </div>
      </div>
    </GlassCard>
  );
}

export function CorrectionsTab({ c }: { c: MockProcessingCase }) {
  const [items, setItems] = useState<ApiCorrectionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCaseCorrections(c.id)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load corrections'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [c.id]);

  async function handleResolve(id: string, note?: string) {
    const updated = await resolveCaseCorrection(c.id, id, { resolutionNote: note });
    // Merge onto the existing row rather than replacing it, so we never drop
    // fields (e.g. reasonCodes) if the API ever returns a partial payload.
    setItems((prev) => prev.map((cr) => (cr.id === id ? { ...cr, ...updated } : cr)));
  }
  async function handleEscalate(id: string, reason: string) {
    const updated = await escalateCaseCorrection(c.id, id, { escalationReason: reason });
    setItems((prev) => prev.map((cr) => (cr.id === id ? { ...cr, ...updated } : cr)));
  }

  const open = items.filter((cr) => cr.status === 'SENT' || cr.status === 'IN_PROGRESS' || cr.status === 'ESCALATED');
  const done = items.filter((cr) => cr.status === 'RESOLVED');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <NewCorrectionForm caseId={c.id} onCreated={(cr) => setItems((p) => [cr, ...p])} />
      </div>

      {loading ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
            <Loader2 size={16} className="sos-spin" />
            <span>Loading corrections…</span>
          </div>
        </GlassCard>
      ) : err ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>
        </GlassCard>
      ) : items.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={ClipboardEdit}
            title="No correction requests"
            description="When a document or piece of information needs fixing, raise a correction here. The client sees the message + required action in their portal."
          />
        </GlassCard>
      ) : (
        <>
          {open.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Open ({open.length})
              </div>
              {open.map((cr) => <CorrectionCard key={cr.id} cr={cr} onResolve={handleResolve} onEscalate={handleEscalate} />)}
            </div>
          ) : null}
          {done.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Resolved ({done.length})
              </div>
              {done.map((cr) => <CorrectionCard key={cr.id} cr={cr} onResolve={handleResolve} onEscalate={handleEscalate} />)}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
