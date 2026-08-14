'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Layers, Megaphone, Plus, Search, Split, Trash2, User, Users } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import {
  deleteRoutingRule,
  listRoutingBranches,
  listRoutingEmployees,
  listRoutingRules,
  upsertRoutingRule,
  type AdRoutingRule,
  type AdRoutingTargetType,
  type MarketingBranch,
  type MarketingRoutingEmployee,
} from '@/lib/marketing';

const NAV_ACCENT = 'var(--sos-brand-primary-strong, #2563eb)';
const PERSON_ACCENT = '#0d9488'; // teal — distinguishes person pins from branch pins

function presenceColor(p: string): string {
  return p === 'ONLINE' ? '#16a34a' : p === 'AWAY' ? '#d97706' : '#9ca3af';
}

export default function MarketingRoutingPage() {
  const [rules, setRules] = useState<AdRoutingRule[]>([]);
  const [branches, setBranches] = useState<MarketingBranch[]>([]);
  const [employees, setEmployees] = useState<MarketingRoutingEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdRoutingRule | 'new' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, b, e] = await Promise.all([listRoutingRules(), listRoutingBranches(), listRoutingEmployees()]);
      setRules(r);
      setBranches(b);
      setEmployees(e);
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
  const employeeName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const employeesByBranchId = useMemo(() => {
    const m = new Map<string, MarketingRoutingEmployee[]>();
    for (const e of employees) {
      const key = e.branchId ?? '—';
      const bucket = m.get(key) ?? [];
      bucket.push(e);
      m.set(key, bucket);
    }
    return m;
  }, [employees]);

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
        description="Pin an ad — or a whole campaign — to a branch, both branches, or specific people. Rules apply to the NEXT new lead an ad produces; existing conversations already assigned to a rep are never touched."
      />

      {/* Teams roster — who sits on each branch */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <Users size={16} color={NAV_ACCENT} />
          <strong style={{ fontSize: 14 }}>Teams</strong>
          <span style={{ fontSize: 12, color: 'var(--sos-text-tertiary, #6b7280)' }}>
            Who sits on each branch · <span style={{ color: '#16a34a' }}>●</span> online · <strong style={{ color: '#16a34a' }}>POOL</strong> = receives WhatsApp leads
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          {branches.map((b) => {
            const list = employeesByBranchId.get(b.id) ?? [];
            const inPool = list.filter((e) => e.inPool).length;
            return (
              <div key={b.id} style={{ border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))', borderRadius: 'var(--sos-radius-md, 10px)', padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>{b.name}</strong>
                  <span style={{ fontSize: 11, color: 'var(--sos-text-tertiary, #6b7280)' }}>{inPool}/{list.length} in pool</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {list.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--sos-text-tertiary, #6b7280)' }}>No employees</span>
                  ) : (
                    list.map((e) => (
                      <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                        <span title={e.presence} style={{ width: 7, height: 7, borderRadius: 999, background: presenceColor(e.presence), flex: '0 0 auto' }} />
                        <span style={{ flex: 1, color: e.inPool ? 'var(--sos-text-primary, #111827)' : 'var(--sos-text-tertiary, #9ca3af)' }}>{e.name}</span>
                        {e.inPool ? <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', letterSpacing: '0.03em' }}>POOL</span> : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setEditing('new')} style={addBtn}>
          <Plus size={14} /> Add rule
        </button>
      </div>

      {error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#b91c1c' }}>
            <AlertTriangle size={18} />
            <span>Couldn&apos;t load routing: {error}</span>
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
                        <span key={id} style={branchPill}>{branchName.get(id) ?? id.slice(0, 8)}</span>
                      ))}
                      {(r.employeeIds ?? []).map((id) => (
                        <span key={id} style={personPill}>
                          <User size={10} /> {employeeName.get(id) ?? id.slice(0, 8)}
                        </span>
                      ))}
                      {r.branchIds.length === 0 && (r.employeeIds ?? []).length === 0 ? (
                        <span style={{ color: 'var(--sos-text-tertiary, #9ca3af)' }}>—</span>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ ...cell, color: 'var(--sos-text-secondary, #4b5563)' }}>{r.notes ?? '—'}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    <button type="button" onClick={() => setEditing(r)} style={btnGhost}>Edit</button>
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
                    No routing rules yet. Every ad round-robins across the whole eligible pool by default. Add a rule to pin an ad or campaign to a branch or specific people.
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
          employees={employees}
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
  employees,
  onClose,
  onSaved,
}: {
  initial: AdRoutingRule | null;
  branches: MarketingBranch[];
  employees: MarketingRoutingEmployee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [targetType, setTargetType] = useState<AdRoutingTargetType>(initial?.targetType ?? 'AD');
  const [targetId, setTargetId] = useState(initial?.targetId ?? '');
  const [branchIds, setBranchIds] = useState<Set<string>>(new Set(initial?.branchIds ?? []));
  const [employeeIds, setEmployeeIds] = useState<Set<string>>(new Set(initial?.employeeIds ?? []));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Only pool-on reps can actually receive a lead, so only they are pickable.
  const poolReps = useMemo(() => employees.filter((e) => e.inPool), [employees]);
  const filteredReps = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? poolReps.filter((e) => e.name.toLowerCase().includes(q)) : poolReps;
    return [...base].sort(
      (a, b) => (a.branchName ?? '').localeCompare(b.branchName ?? '') || a.name.localeCompare(b.name),
    );
  }, [poolReps, search]);

  const canSave = targetId.trim().length > 0 && (branchIds.size > 0 || employeeIds.size > 0) && !saving;

  const toggleBranch = (id: string) =>
    setBranchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const togglePerson = (id: string) =>
    setEmployeeIds((prev) => {
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
        employeeIds: [...employeeIds],
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
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 100 }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(540px, 92vw)',
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
          <Label>Or specific people{employeeIds.size > 0 ? ` · ${employeeIds.size} selected` : ''}</Label>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--sos-text-tertiary, #9ca3af)' }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reps…" style={{ ...input, paddingLeft: 30 }} />
          </div>
          <div
            style={{
              maxHeight: 200,
              overflowY: 'auto',
              border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.10))',
              borderRadius: 'var(--sos-radius-md, 10px)',
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {filteredReps.length === 0 ? (
              <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--sos-text-tertiary, #6b7280)' }}>
                No pool reps match.
              </div>
            ) : (
              filteredReps.map((e) => {
                const checked = employeeIds.has(e.id);
                return (
                  <label
                    key={e.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 8px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      background: checked ? 'rgba(13,148,136,0.08)' : 'transparent',
                      fontSize: 13,
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => togglePerson(e.id)} />
                    <span title={e.presence} style={{ width: 7, height: 7, borderRadius: 999, background: presenceColor(e.presence), flex: '0 0 auto' }} />
                    <span style={{ flex: 1 }}>{e.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--sos-text-tertiary, #9ca3af)' }}>{e.branchName ?? '—'}</span>
                  </label>
                );
              })
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--sos-text-tertiary, #6b7280)', marginTop: 6 }}>
            Only reps with the WhatsApp pool ON are listed — the people a lead can actually be delivered to. A branch and specific people both apply (their union); if the chosen people are all offline, leads wait for the retry sweeper.
          </div>
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
const branchPill: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 'var(--sos-radius-pill, 999px)',
  background: 'var(--sos-brand-primary-soft, rgba(37,99,235,0.10))',
  color: NAV_ACCENT,
  border: '1px solid var(--sos-brand-primary-border, rgba(37,99,235,0.20))',
};
const personPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 'var(--sos-radius-pill, 999px)',
  background: 'rgba(13,148,136,0.10)',
  color: PERSON_ACCENT,
  border: '1px solid rgba(13,148,136,0.25)',
};
const addBtn: React.CSSProperties = {
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
