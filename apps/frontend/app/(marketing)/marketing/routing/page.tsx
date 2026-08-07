'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Layers, Megaphone, Plus, Split, Trash2 } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import {
  deleteRoutingRule,
  listRoutingBranches,
  listRoutingRules,
  upsertRoutingRule,
  type AdRoutingRule,
  type AdRoutingTargetType,
  type MarketingBranch,
} from '@/lib/marketing';

const NAV_ACCENT = 'var(--sos-brand-primary-strong, #2563eb)';

export default function MarketingRoutingPage() {
  const [rules, setRules] = useState<AdRoutingRule[]>([]);
  const [branches, setBranches] = useState<MarketingBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdRoutingRule | 'new' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, b] = await Promise.all([listRoutingRules(), listRoutingBranches()]);
      setRules(r);
      setBranches(b);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

  const doDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteRoutingRule(id);
      await refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Lead Routing"
        description="Pin an ad — or a whole campaign — to Islamabad, Lahore, or both. Rules apply to the NEXT new lead an ad produces; existing conversations already assigned to a rep are never touched."
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)' }}>
          {branches.map((b) => (
            <span key={b.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Split size={12} /> <strong style={{ color: 'var(--sos-text-primary, #111827)' }}>{b.name}</strong> · {b.employeeCount} employee{b.employeeCount === 1 ? '' : 's'}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            fontSize: 13,
            fontWeight: 600,
            border: '1px solid var(--sos-brand-primary-border, rgba(37,99,235,0.30))',
            borderRadius: 'var(--sos-radius-md, 10px)',
            background: 'var(--sos-brand-primary-strong, #2563eb)',
            color: '#ffffff',
            cursor: 'pointer',
          }}
        >
          <Plus size={14} /> Add rule
        </button>
      </div>

      {error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#b91c1c' }}>
            <AlertTriangle size={18} />
            <span>Couldn't load routing: {error}</span>
          </div>
        </GlassCard>
      ) : null}

      <GlassCard variant="default">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--sos-text-tertiary, #6b7280)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={cellHead}>Target</th>
                <th style={cellHead}>Meta ID</th>
                <th style={cellHead}>Routes to</th>
                <th style={cellHead}>Notes</th>
                <th style={{ ...cellHead, width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td style={cell}>
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      {r.targetType === 'AD' ? <Megaphone size={13} color={NAV_ACCENT} /> : <Layers size={13} color={NAV_ACCENT} />}
                      {r.targetType}
                    </span>
                  </td>
                  <td style={{ ...cell, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12 }}>{r.targetId}</td>
                  <td style={cell}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {r.branchIds.map((id) => (
                        <span
                          key={id}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 'var(--sos-radius-pill, 999px)',
                            background: 'var(--sos-brand-primary-soft, rgba(37,99,235,0.10))',
                            color: NAV_ACCENT,
                            border: '1px solid var(--sos-brand-primary-border, rgba(37,99,235,0.20))',
                          }}
                        >
                          {branchName.get(id) ?? id.slice(0, 8)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ ...cell, color: 'var(--sos-text-secondary, #4b5563)' }}>{r.notes ?? '—'}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      style={btnGhost}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete this ${r.targetType} rule?`)) void doDelete(r.id);
                      }}
                      disabled={deletingId === r.id}
                      style={{ ...btnGhost, color: '#b91c1c' }}
                      title="Delete rule"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && rules.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)' }}>
                    No routing rules yet. Every ad round-robins across the whole eligible pool by default. Add a rule to pin an ad or a whole campaign to a branch.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {editing ? (
        <RuleEditor
          initial={editing === 'new' ? null : editing}
          branches={branches}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function RuleEditor({
  initial,
  branches,
  onClose,
  onSaved,
}: {
  initial: AdRoutingRule | null;
  branches: MarketingBranch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [targetType, setTargetType] = useState<AdRoutingTargetType>(initial?.targetType ?? 'AD');
  const [targetId, setTargetId] = useState(initial?.targetId ?? '');
  const [branchIds, setBranchIds] = useState<Set<string>>(new Set(initial?.branchIds ?? []));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSave = targetId.trim().length > 0 && branchIds.size > 0 && !saving;

  const toggleBranch = (id: string) =>
    setBranchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await upsertRoutingRule({
        targetType,
        targetId: targetId.trim(),
        branchIds: [...branchIds],
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(520px, 92vw)',
          maxHeight: '90vh',
          overflow: 'auto',
          background: 'var(--sos-surface-primary, #ffffff)',
          borderRadius: 'var(--sos-radius-lg, 14px)',
          border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.10))',
          padding: 22,
          boxShadow: 'var(--sos-shadow-lg, 0 10px 40px rgba(0,0,0,0.15))',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{initial ? 'Edit routing rule' : 'New routing rule'}</div>
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', marginTop: 4 }}>
            Applies to the next lead the ad or campaign produces. Existing conversations already assigned to a rep are never touched.
          </div>
        </div>

        <div>
          <Label>Target type</Label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['AD', 'CAMPAIGN'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setTargetType(v)}
                disabled={initial != null}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 'var(--sos-radius-md, 10px)',
                  border: `1px solid ${targetType === v ? 'var(--sos-brand-primary-border, rgba(37,99,235,0.40))' : 'var(--sos-border-subtle, rgba(0,0,0,0.10))'}`,
                  background: targetType === v ? 'var(--sos-brand-primary-soft, rgba(37,99,235,0.10))' : 'transparent',
                  color: targetType === v ? NAV_ACCENT : 'var(--sos-text-secondary, #4b5563)',
                  cursor: initial ? 'not-allowed' : 'pointer',
                  opacity: initial ? 0.7 : 1,
                }}
              >
                {v === 'AD' ? 'Single ad' : 'Whole campaign'}
              </button>
            ))}
          </div>
          {initial ? (
            <div style={{ fontSize: 11, color: 'var(--sos-text-tertiary, #6b7280)', marginTop: 4 }}>
              Type is locked when editing — delete + recreate to change target type.
            </div>
          ) : null}
        </div>

        <div>
          <Label>Meta {targetType === 'AD' ? 'ad' : 'campaign'} ID</Label>
          <input
            type="text"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={initial != null}
            placeholder={targetType === 'AD' ? 'e.g. 52533803620533' : 'e.g. 23851234567890000'}
            style={input}
          />
          <div style={{ fontSize: 11, color: 'var(--sos-text-tertiary, #6b7280)', marginTop: 4 }}>
            Numeric ID from Meta Ads Manager. You can find it on the Meta Ads page in this portal.
          </div>
        </div>

        <div>
          <Label>Route to branches</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {branches.map((b) => {
              const checked = branchIds.has(b.id);
              return (
                <label
                  key={b.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 'var(--sos-radius-md, 10px)',
                    border: `1px solid ${checked ? 'var(--sos-brand-primary-border, rgba(37,99,235,0.40))' : 'var(--sos-border-subtle, rgba(0,0,0,0.10))'}`,
                    background: checked ? 'var(--sos-brand-primary-soft, rgba(37,99,235,0.06))' : 'transparent',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleBranch(b.id)} />
                  <span style={{ flex: 1 }}>
                    <strong>{b.name}</strong>
                    {b.city ? <span style={{ color: 'var(--sos-text-tertiary, #6b7280)' }}> · {b.city}</span> : null}
                  </span>
                  <span style={{ fontSize: 11, color: b.employeeCount === 0 ? '#b91c1c' : 'var(--sos-text-tertiary, #6b7280)' }}>
                    {b.employeeCount} employee{b.employeeCount === 1 ? '' : 's'}
                  </span>
                </label>
              );
            })}
          </div>
          {branchIds.size > 1 ? (
            <div style={{ fontSize: 11, color: 'var(--sos-text-tertiary, #6b7280)', marginTop: 6 }}>
              Multiple branches selected — round-robin picks ONE rep across all of them. A lead is never duplicated.
            </div>
          ) : null}
        </div>

        <div>
          <Label>Notes (optional)</Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. Judicial Review campaign — high intent, Lahore-only"
            style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        {err ? (
          <div style={{ padding: 10, background: 'rgba(220,38,38,0.08)', borderRadius: 'var(--sos-radius-md, 10px)', color: '#b91c1c', fontSize: 12 }}>
            {err}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" onClick={onClose} style={btnGhostLg}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={!canSave} style={{ ...btnPrimary, opacity: canSave ? 1 : 0.6, cursor: canSave ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Add rule'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--sos-text-secondary, #4b5563)', marginBottom: 6 }}>
      {children}
    </div>
  );
}

const cellHead: React.CSSProperties = {
  padding: '8px 8px',
  borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))',
  whiteSpace: 'nowrap',
};
const cell: React.CSSProperties = {
  padding: '10px 8px',
  borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))',
  verticalAlign: 'top',
};
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.10))',
  borderRadius: 'var(--sos-radius-md, 10px)',
  background: 'var(--sos-surface-primary, #ffffff)',
  color: 'var(--sos-text-primary, #111827)',
};
const btnGhost: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: 12,
  fontWeight: 600,
  border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.10))',
  borderRadius: 'var(--sos-radius-sm, 7px)',
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--sos-text-secondary, #4b5563)',
  marginLeft: 4,
};
const btnGhostLg: React.CSSProperties = {
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.10))',
  borderRadius: 'var(--sos-radius-md, 10px)',
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--sos-text-secondary, #4b5563)',
};
const btnPrimary: React.CSSProperties = {
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid var(--sos-brand-primary-border, rgba(37,99,235,0.30))',
  borderRadius: 'var(--sos-radius-md, 10px)',
  background: 'var(--sos-brand-primary-strong, #2563eb)',
  color: '#ffffff',
};
