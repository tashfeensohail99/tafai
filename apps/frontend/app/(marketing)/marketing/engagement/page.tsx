'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, RefreshCw, ThumbsUp, Plus } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import { FormSelect, FormTextarea } from '@/components/sales-v2/ui/FormFields';
import { useMarketingSession } from '@/components/layout/MarketingShell';
import {
  getScoreboard,
  getHandles,
  getPosts,
  submitClaim,
  runSweep,
  statusLabel,
  type Scoreboard,
  type HandleRow,
  type SocialPostRow,
  type SocialEngagementStatus,
} from '@/lib/social-engagement';

const DAY_OPTIONS = [
  { days: 7, label: 'This week' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

export default function TeamEngagementPage() {
  const { user } = useMarketingSession();
  const canManage = user.permissions.includes('social.engagement.manage');
  const canSubmit = user.permissions.includes('social.engagement.submit');

  const [days, setDays] = useState(7);
  const [data, setData] = useState<Scoreboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getScoreboard(days)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const onSweep = async () => {
    setSweeping(true);
    setSweepMsg(null);
    try {
      const res = await runSweep();
      setSweepMsg(
        res.skippedReason
          ? `Sweep skipped: ${res.skippedReason}`
          : `Swept ${res.pagesScanned} page(s): ${res.igCommentsMatched} IG match(es), ${res.claimsResolved} claim(s) resolved.`,
      );
      load();
    } catch (e) {
      setSweepMsg(`Sweep failed: ${(e as Error).message}`);
    } finally {
      setSweeping(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Team Engagement"
        description="API-verified proof that reps commented on our Facebook & Instagram posts — no more screenshots."
      />

      {/* Capability banner — so the numbers are read correctly. */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--sos-brand-primary-strong, #2563eb)', flexShrink: 0 }}>
            <Info size={17} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--sos-text-primary, #111827)' }}>How verification works.</strong>{' '}
            <span style={{ color: '#be185d', fontWeight: 600 }}>Instagram comments</span> are
            <strong> fully verified</strong> automatically — we match the commenter&apos;s username to a registered handle.{' '}
            <span style={{ color: '#1d4ed8', fontWeight: 600 }}>Facebook comments</span> are
            <strong> text-verified only</strong>: Meta hides the author, so we confirm the comment text exists on the post but can&apos;t prove who wrote it (a rep logs a claim).{' '}
            <span style={{ color: '#6b7280', fontWeight: 600 }}><ThumbsUp size={12} style={{ verticalAlign: '-2px' }} /> Likes/reactions</span> are
            <strong> not verifiable</strong> — Meta exposes no list of who liked. We measure comments.
          </div>
        </div>
      </GlassCard>

      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {DAY_OPTIONS.map((o) => (
            <button
              key={o.days}
              type="button"
              onClick={() => setDays(o.days)}
              style={{
                padding: '7px 14px',
                borderRadius: 10,
                border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.12))',
                background: days === o.days ? 'var(--sos-brand-primary-strong, #2563eb)' : 'var(--sos-surface, #fff)',
                color: days === o.days ? '#fff' : 'var(--sos-text-secondary, #4b5563)',
                fontSize: 13,
                fontWeight: days === o.days ? 600 : 500,
                cursor: 'pointer',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canSubmit && canManage ? (
            <button type="button" onClick={() => setClaimOpen(true)} style={btnPrimary}>
              <Plus size={14} /> Log a Facebook comment
            </button>
          ) : null}
          {canManage ? (
            <button type="button" onClick={onSweep} disabled={sweeping} style={btnGhost}>
              <RefreshCw size={14} style={sweeping ? { animation: 'spin 1s linear infinite' } : undefined} />
              {sweeping ? 'Sweeping…' : 'Run sweep'}
            </button>
          ) : null}
        </div>
      </div>

      {sweepMsg ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--sos-text-secondary,#4b5563)' }}>
            <CheckCircle2 size={16} style={{ color: '#059669' }} /> {sweepMsg}
          </div>
        </GlassCard>
      ) : null}

      {/* Totals */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Stat label="IG verified" value={loading ? '…' : String(data?.totals.verifiedIg ?? 0)} tone="#be185d" />
        <Stat label="FB text-verified" value={loading ? '…' : String(data?.totals.textVerifiedFb ?? 0)} tone="#1d4ed8" />
        <Stat label="Reps engaged" value={loading ? '…' : String(data?.totals.reps ?? 0)} tone="#059669" />
        <Stat label="FB claims not found" value={loading ? '…' : String(data?.totals.notFound ?? 0)} tone={(data?.totals.notFound ?? 0) > 0 ? '#d97706' : '#6b7280'} />
      </div>

      {error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#b91c1c' }}>
            <AlertTriangle size={18} />
            <span>Couldn&apos;t load: {error}</span>
          </div>
        </GlassCard>
      ) : null}

      {/* Per-rep scoreboard */}
      <GlassCard variant="default">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={th}>#</th>
                <th style={th}>Rep</th>
                <th style={th}>IG handle</th>
                <th style={{ ...th, textAlign: 'right' }}>IG verified</th>
                <th style={{ ...th, textAlign: 'right' }}>FB text-verified</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(data?.reps ?? []).map((r, i) => (
                <tr key={r.employeeId}>
                  <td style={{ ...cell, color: 'var(--sos-text-tertiary, #6b7280)' }}>{i + 1}</td>
                  <td style={cell}>
                    <span style={{ fontWeight: 500 }}>{r.name}</span>
                    {!r.isActive ? <span style={inactivePill}>inactive</span> : null}
                  </td>
                  <td style={{ ...cell, color: 'var(--sos-text-tertiary,#6b7280)' }}>
                    {r.instagramHandle ? `@${r.instagramHandle}` : <span style={{ color: '#d97706' }}>not set</span>}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', color: '#be185d', fontWeight: 600 }}>{r.verifiedIg}</td>
                  <td style={{ ...cell, textAlign: 'right', color: '#1d4ed8' }}>{r.textVerifiedFb}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{r.total}</td>
                </tr>
              ))}
              {!loading && (data?.reps.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...cell, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)', padding: 20 }}>
                    No verified engagement in this window yet. Set Instagram handles under <strong>Social Handles</strong>, then run a sweep.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {claimOpen ? <ClaimModal onClose={() => setClaimOpen(false)} onDone={load} /> : null}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ClaimModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [employees, setEmployees] = useState<HandleRow[]>([]);
  const [posts, setPosts] = useState<SocialPostRow[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [postExternalId, setPostExternalId] = useState('');
  const [commentText, setCommentText] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: SocialEngagementStatus } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getHandles(), getPosts({ platform: 'FACEBOOK', days: 60 })])
      .then(([h, p]) => {
        setEmployees(h);
        setPosts(p);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  const postMap = useMemo(() => new Map(posts.map((p) => [p.externalId, p])), [posts]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const chosen = postMap.get(postExternalId);
      const res = await submitClaim({
        employeeId,
        postExternalId,
        postUrl: chosen?.permalink ?? undefined,
        commentText,
        screenshot,
      });
      setResult({ status: res.status });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = employeeId && postExternalId && commentText.trim().length >= 3 && !busy;

  return (
    <div data-sos-modal="" style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>Log a Facebook comment</h3>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--sos-text-secondary,#4b5563)', lineHeight: 1.5 }}>
          Facebook hides the comment author, so we confirm the <strong>text</strong> exists on the post. This records a
          <strong> text-verified</strong> engagement — it can&apos;t prove authorship. An optional screenshot is kept as secondary evidence.
        </p>

        {result ? (
          <div>
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                background: result.status === 'TEXT_VERIFIED_AUTHOR_UNCONFIRMED' ? 'rgba(5,150,105,0.1)' : result.status === 'NOT_FOUND' ? 'rgba(217,119,6,0.1)' : 'rgba(37,99,235,0.1)',
                fontSize: 13,
                marginBottom: 14,
              }}
            >
              <strong>{statusLabel(result.status)}.</strong>{' '}
              {result.status === 'TEXT_VERIFIED_AUTHOR_UNCONFIRMED'
                ? 'The comment text was found on the post.'
                : result.status === 'NOT_FOUND'
                  ? 'That text was not found among the post’s comments. Double-check the exact wording.'
                  : 'We could not reach the post comments right now — this claim is pending and the next sweep will retry.'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={btnPrimary}>Done</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FormSelect
              label="Rep"
              required
              placeholder="Select a rep…"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              options={employees.map((e) => ({ value: e.employeeId, label: e.name }))}
            />
            <FormSelect
              label="Facebook post"
              required
              placeholder={posts.length ? 'Select a swept post…' : 'No posts swept yet — run a sweep first'}
              value={postExternalId}
              onChange={(e) => setPostExternalId(e.target.value)}
              options={posts.map((p) => ({
                value: p.externalId,
                label: `${p.postedAt ? new Date(p.postedAt).toLocaleDateString() : '—'} · ${(p.caption ?? p.externalId).slice(0, 60)}`,
              }))}
            />
            <FormTextarea
              label="Comment text (exact)"
              required
              rows={3}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              hint="Paste the exact text the rep commented. Matching is case-insensitive."
            />
            <div>
              <label className="sos-label">Screenshot (optional)</label>
              <input type="file" accept="image/*" onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
            </div>
            {err ? <div className="sos-help sos-help--error">{err}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
              <button type="button" onClick={submit} disabled={!canSubmit} style={{ ...btnPrimary, opacity: canSubmit ? 1 : 0.5 }}>
                {busy ? 'Verifying…' : 'Verify & log'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <GlassCard variant="default">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--sos-text-tertiary, #6b7280)' }}>{label}</span>
        <span style={{ fontSize: 24, fontWeight: 700, color: tone, lineHeight: 1 }}>{value}</span>
      </div>
    </GlassCard>
  );
}

const cell: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))' };
const th: React.CSSProperties = {
  padding: '8px',
  borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--sos-text-tertiary, #6b7280)',
};
const inactivePill: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 10,
  padding: '1px 6px',
  borderRadius: 6,
  background: 'var(--sos-border-subtle, rgba(0,0,0,0.08))',
  color: 'var(--sos-text-tertiary, #6b7280)',
};
const btnPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--sos-brand-primary-strong, #2563eb)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 10,
  border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.12))',
  background: 'var(--sos-surface, #fff)',
  color: 'var(--sos-text-secondary, #4b5563)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};
const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};
const modal: React.CSSProperties = {
  background: 'var(--sos-surface, #fff)',
  color: 'var(--sos-text-primary, #111827)',
  borderRadius: 16,
  padding: 22,
  width: '100%',
  maxWidth: 480,
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
};
