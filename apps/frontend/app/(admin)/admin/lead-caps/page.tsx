'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Gauge, Info, Loader2, Save } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useAdminSession } from '@/components/layout/AdminShell';
import { apiFetch } from '@/lib/api-client';

interface LeadCapRow {
  id: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
  presenceStatus: 'ONLINE' | 'AWAY' | 'OFFLINE';
  presenceLocked: boolean;
  dailyLeadCap: number | null;
  usedToday: number;
  capReached: boolean;
}
interface LeadCapsResponse {
  reps: LeadCapRow[];
  allOnlineCapped: boolean;
  waitingUnassigned: number;
}

/**
 * Admin → Lead Caps. Set a daily limit on how many ONLINE round-robin leads
 * (inbound WhatsApp / CTWA) each rep receives. CSV imports, manual assignments
 * and live calls are never affected. Blank = unlimited; 0 = block all new online
 * leads (a soft pause — existing chats are kept).
 */
export default function LeadCapsPage() {
  const { user } = useAdminSession();
  const canManage = user.permissions.includes('leads.assign');

  const [data, setData] = useState<LeadCapsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-rep draft cap strings ('' = unlimited). Seeded from the server rows.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const muted = 'var(--sos-text-muted, #64748b)';
  const border = '1px solid var(--sos-border, rgba(148,163,184,0.25))';

  const load = () => {
    setLoading(true);
    setError(null);
    apiFetch<LeadCapsResponse>('/admin/lead-caps', { cache: 'no-store' })
      .then((r) => {
        setData(r);
        setDrafts(Object.fromEntries(r.reps.map((rep) => [rep.id, rep.dailyLeadCap == null ? '' : String(rep.dailyLeadCap)])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load reps'))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (canManage) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const byBranch = useMemo(() => {
    if (!data) return [];
    const groups = new Map<string, { branch: string; reps: LeadCapRow[] }>();
    for (const rep of data.reps) {
      const key = rep.branchName ?? 'Unassigned branch';
      if (!groups.has(key)) groups.set(key, { branch: key, reps: [] });
      groups.get(key)!.reps.push(rep);
    }
    // Islamabad (catch-all) first, then alphabetical, Unassigned last.
    return [...groups.values()].sort((a, b) => {
      if (a.branch === 'Unassigned branch') return 1;
      if (b.branch === 'Unassigned branch') return -1;
      if (/islamabad/i.test(a.branch)) return -1;
      if (/islamabad/i.test(b.branch)) return 1;
      return a.branch.localeCompare(b.branch);
    });
  }, [data]);

  async function save(rep: LeadCapRow) {
    const raw = (drafts[rep.id] ?? '').trim();
    let cap: number | null;
    if (raw === '') cap = null;
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        setError(`"${raw}" isn't a valid cap for ${rep.name} — use a whole number ≥ 0, or clear it for unlimited.`);
        return;
      }
      cap = n;
    }
    if (cap === 0 && !window.confirm(`Set ${rep.name}'s cap to 0? This blocks ALL new online leads to them (they keep existing chats). Continue?`)) {
      return;
    }
    setSavingId(rep.id);
    setError(null);
    try {
      await apiFetch(`/admin/lead-caps/${rep.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ dailyLeadCap: cap }),
      });
      setSavedId(rep.id);
      setTimeout(() => setSavedId((s) => (s === rep.id ? null : s)), 1800);
      load(); // refresh usage + all-capped state
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not update ${rep.name}`);
    } finally {
      setSavingId(null);
    }
  }

  if (!canManage) {
    return <PermissionDeniedState message="You need the leads.assign permission to manage lead caps." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="CRM"
        title="Lead Caps"
        description="Limit how many ONLINE round-robin leads (inbound WhatsApp & Click-to-WhatsApp) each rep receives per day. CSV imports, manual assignments and live calls are never capped."
      />

      {/* How it works */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--sos-brand-primary-strong, #2563eb)', flexShrink: 0 }}><Info size={17} /></div>
          <div style={{ fontSize: 12.5, color: 'var(--sos-text-secondary, #4b5563)', lineHeight: 1.55 }}>
            <strong style={{ color: 'var(--sos-text-primary, #111827)' }}>Blank = unlimited.</strong>{' '}
            A number is the most new online leads that rep gets today (resets at midnight, PKT). <strong>0</strong> blocks all new online leads — a soft pause; they keep their existing chats. The count is today&apos;s online leads only; a capped rep still receives CSV leads and live calls.
          </div>
        </div>
      </GlassCard>

      {/* All-capped alert */}
      {data?.allOnlineCapped ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#b45309' }}>
            <AlertTriangle size={18} />
            <span style={{ fontSize: 13 }}>
              <strong>Every online rep has hit their cap.</strong> New online leads are waiting to be assigned{data.waitingUnassigned > 0 ? ` (${data.waitingUnassigned} so far today)` : ''} and will be handed out once a rep frees up, a cap is raised, or the daily reset at midnight. Raise a cap below to release them now.
            </span>
          </div>
        </GlassCard>
      ) : null}

      {error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#b91c1c' }}>
            <AlertTriangle size={18} /> <span style={{ fontSize: 13 }}>{error}</span>
          </div>
        </GlassCard>
      ) : null}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: muted, padding: '24px 0' }}>
          <Loader2 size={16} className="animate-spin" /> Loading reps…
        </div>
      ) : !data || data.reps.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: muted }}>No round-robin reps found.</div>
      ) : (
        byBranch.map((group) => (
          <GlassCard key={group.branch} variant="default" padded={false}>
            <div style={{ padding: '12px 16px', borderBottom: border, fontWeight: 600, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Gauge size={15} style={{ color: 'var(--sos-accent, #b8860b)' }} /> {group.branch}
              <span style={{ color: muted, fontWeight: 400 }}>· {group.reps.length} rep{group.reps.length === 1 ? '' : 's'}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    <th style={cellHead}>Rep</th>
                    <th style={cellHead}>Status</th>
                    <th style={{ ...cellHead, textAlign: 'right' }}>Used today</th>
                    <th style={cellHead}>Daily cap</th>
                    <th style={cellHead}></th>
                  </tr>
                </thead>
                <tbody>
                  {group.reps.map((rep) => {
                    const draft = drafts[rep.id] ?? '';
                    const current = rep.dailyLeadCap == null ? '' : String(rep.dailyLeadCap);
                    const dirty = draft.trim() !== current;
                    return (
                      <tr key={rep.id}>
                        <td style={cell}>
                          <div style={{ fontWeight: 500 }}>{rep.name}</div>
                        </td>
                        <td style={cell}><PresenceBadge rep={rep} /></td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          <span style={{ fontWeight: 600, color: rep.capReached ? '#b45309' : undefined }}>{rep.usedToday}</span>
                          <span style={{ color: muted }}> / {rep.dailyLeadCap == null ? '∞' : rep.dailyLeadCap}</span>
                        </td>
                        <td style={cell}>
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={draft}
                            placeholder="∞"
                            onChange={(e) => setDrafts((d) => ({ ...d, [rep.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter' && dirty) void save(rep); }}
                            style={{
                              width: 84,
                              border,
                              borderRadius: 8,
                              padding: '6px 9px',
                              fontSize: 13,
                              background: 'var(--sos-surface-solid, #fff)',
                              color: 'var(--sos-text-primary, #0f172a)',
                              outline: 'none',
                            }}
                          />
                        </td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => void save(rep)}
                            disabled={!dirty || savingId === rep.id}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              border,
                              borderRadius: 8,
                              padding: '6px 12px',
                              fontSize: 12.5,
                              cursor: dirty && savingId !== rep.id ? 'pointer' : 'default',
                              opacity: dirty ? 1 : 0.45,
                              background: savedId === rep.id ? 'var(--sos-success-soft, #dcfce7)' : 'var(--sos-surface, rgba(255,255,255,0.6))',
                              color: savedId === rep.id ? '#15803d' : 'var(--sos-text-primary, #0f172a)',
                            }}
                          >
                            {savingId === rep.id ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                            {savedId === rep.id ? 'Saved' : 'Save'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </GlassCard>
        ))
      )}
    </div>
  );
}

function PresenceBadge({ rep }: { rep: LeadCapRow }) {
  const base: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
    display: 'inline-block',
  };
  if (rep.presenceLocked) {
    return <span style={{ ...base, background: '#f1f5f9', color: '#64748b' }}>Paused</span>;
  }
  const map: Record<LeadCapRow['presenceStatus'], { bg: string; fg: string; label: string }> = {
    ONLINE: { bg: '#dcfce7', fg: '#15803d', label: 'Online' },
    AWAY: { bg: '#fef9c3', fg: '#a16207', label: 'Away' },
    OFFLINE: { bg: '#f1f5f9', fg: '#64748b', label: 'Offline' },
  };
  const s = map[rep.presenceStatus];
  return <span style={{ ...base, background: s.bg, color: s.fg }}>{s.label}</span>;
}

const cellHead: React.CSSProperties = {
  padding: '9px 12px',
  borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))',
  whiteSpace: 'nowrap',
};
const cell: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))',
  verticalAlign: 'middle',
};
