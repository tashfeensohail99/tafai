'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Info, Search } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import { getHandles, updateHandle, type HandleRow } from '@/lib/social-engagement';

interface Draft {
  instagramHandle: string;
  facebookProfileUrl: string;
  facebookDisplayName: string;
}

export default function SocialHandlesPage() {
  const [rows, setRows] = useState<HandleRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    getHandles()
      .then((data) => {
        setRows(data);
        const d: Record<string, Draft> = {};
        for (const r of data) {
          d[r.employeeId] = {
            instagramHandle: r.instagramHandle ?? '',
            facebookProfileUrl: r.facebookProfileUrl ?? '',
            facebookDisplayName: r.facebookDisplayName ?? '',
          };
        }
        setDrafts(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const save = async (id: string) => {
    const d = drafts[id];
    if (!d) return;
    setSavingId(id);
    setError(null);
    try {
      await updateHandle(id, {
        instagramHandle: d.instagramHandle.trim() || null,
        facebookProfileUrl: d.facebookProfileUrl.trim() || null,
        facebookDisplayName: d.facebookDisplayName.trim() || null,
      });
      setRows((prev) =>
        prev.map((r) =>
          r.employeeId === id
            ? {
                ...r,
                instagramHandle: d.instagramHandle.trim().replace(/^@+/, '').toLowerCase() || null,
                facebookProfileUrl: d.facebookProfileUrl.trim() || null,
                facebookDisplayName: d.facebookDisplayName.trim() || null,
              }
            : r,
        ),
      );
      setSavedId(id);
      setTimeout(() => setSavedId((cur) => (cur === id ? null : cur)), 1800);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  const dirty = (r: HandleRow) => {
    const d = drafts[r.employeeId];
    if (!d) return false;
    return (
      d.instagramHandle.trim().replace(/^@+/, '').toLowerCase() !== (r.instagramHandle ?? '') ||
      d.facebookProfileUrl.trim() !== (r.facebookProfileUrl ?? '') ||
      d.facebookDisplayName.trim() !== (r.facebookDisplayName ?? '')
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Social Handles"
        description="Register each rep's Instagram username so their IG comments on company posts verify automatically."
      />

      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--sos-brand-primary-strong, #2563eb)', flexShrink: 0 }}>
            <Info size={17} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', lineHeight: 1.6 }}>
            The <strong>Instagram handle</strong> is what makes a rep&apos;s IG comments verifiable — the sweep matches it to the commenter&apos;s username (no leading <code>@</code> needed). The Facebook fields are reference-only: Meta hides the FB comment author, so FB engagement is proven via a text claim, not the profile.
          </div>
        </div>
      </GlassCard>

      <div style={{ position: 'relative', maxWidth: 280 }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--sos-text-tertiary, #6b7280)' }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search rep…"
          style={{
            padding: '8px 10px 8px 30px',
            borderRadius: 10,
            border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.12))',
            background: 'var(--sos-surface, #fff)',
            color: 'var(--sos-text-primary, #111827)',
            fontSize: 13,
            width: '100%',
          }}
        />
      </div>

      {error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#b91c1c' }}>
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        </GlassCard>
      ) : null}

      <GlassCard variant="default">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={th}>Rep</th>
                <th style={th}>Instagram handle</th>
                <th style={th}>Facebook profile URL</th>
                <th style={th}>Facebook name</th>
                <th style={{ ...th, width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const d = drafts[r.employeeId];
                return (
                  <tr key={r.employeeId}>
                    <td style={cell}>
                      <span style={{ fontWeight: 500 }}>{r.name}</span>
                      {!r.isActive ? <span style={inactivePill}>inactive</span> : null}
                    </td>
                    <td style={cell}>
                      <input className="sos-input" placeholder="username" value={d?.instagramHandle ?? ''} onChange={(e) => setDraft(r.employeeId, { instagramHandle: e.target.value })} style={inp} />
                    </td>
                    <td style={cell}>
                      <input className="sos-input" placeholder="https://facebook.com/…" value={d?.facebookProfileUrl ?? ''} onChange={(e) => setDraft(r.employeeId, { facebookProfileUrl: e.target.value })} style={inp} />
                    </td>
                    <td style={cell}>
                      <input className="sos-input" placeholder="Display name" value={d?.facebookDisplayName ?? ''} onChange={(e) => setDraft(r.employeeId, { facebookDisplayName: e.target.value })} style={inp} />
                    </td>
                    <td style={cell}>
                      <button
                        type="button"
                        onClick={() => save(r.employeeId)}
                        disabled={!dirty(r) || savingId === r.employeeId}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '6px 12px',
                          borderRadius: 9,
                          border: 'none',
                          background: savedId === r.employeeId ? '#059669' : dirty(r) ? 'var(--sos-brand-primary-strong, #2563eb)' : 'var(--sos-border-subtle, rgba(0,0,0,0.08))',
                          color: dirty(r) || savedId === r.employeeId ? '#fff' : 'var(--sos-text-tertiary, #6b7280)',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: dirty(r) ? 'pointer' : 'default',
                        }}
                      >
                        {savedId === r.employeeId ? <><Check size={13} /> Saved</> : savingId === r.employeeId ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...cell, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)', padding: 20 }}>
                    {q ? 'No rep matches your search.' : 'No employees found.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
}

const cell: React.CSSProperties = { padding: '8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))', verticalAlign: 'middle' };
const th: React.CSSProperties = {
  padding: '8px',
  borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--sos-text-tertiary, #6b7280)',
};
const inp: React.CSSProperties = { fontSize: 13, minWidth: 140, width: '100%' };
const inactivePill: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 10,
  padding: '1px 6px',
  borderRadius: 6,
  background: 'var(--sos-border-subtle, rgba(0,0,0,0.08))',
  color: 'var(--sos-text-tertiary, #6b7280)',
};
