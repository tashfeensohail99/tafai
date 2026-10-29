'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Info, Mail, Megaphone, RefreshCw } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import {
  getAlertConfig,
  updateAlertConfig,
  getRecentAlerts,
  pollAlertsNow,
  type SocialAlertConfig,
  type RecentAlert,
  type AlertChannel,
  type AlertPlatform,
} from '@/lib/social-alerts';

const CHANNELS: { key: AlertChannel; label: string; icon: typeof Bell }[] = [
  { key: 'EMAIL', label: 'Email', icon: Mail },
  { key: 'BELL', label: 'In-app + push', icon: Bell },
  { key: 'BANNER', label: 'Banner', icon: Megaphone },
];
const PLATFORMS: AlertPlatform[] = ['FACEBOOK', 'INSTAGRAM'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function PostAlertsPage() {
  const [cfg, setCfg] = useState<SocialAlertConfig | null>(null);
  const [recent, setRecent] = useState<RecentAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getAlertConfig(), getRecentAlerts(25)])
      .then(([c, r]) => {
        setCfg(c);
        setRecent(r);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const patch = async (p: Parameters<typeof updateAlertConfig>[0], note?: string) => {
    if (!cfg) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      await updateAlertConfig(p);
      const next = await getAlertConfig();
      setCfg(next);
      if (note) setMsg(note);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const onPoll = async () => {
    setPolling(true);
    setMsg(null);
    try {
      const res = await pollAlertsNow();
      setMsg(res.skippedReason ? `Poll skipped: ${res.skippedReason}` : `Polled: ${res.postsSeen} post(s) seen, ${res.alertsSent} alert(s) sent to ${res.recipients} recipient(s).`);
      load();
    } catch (e) {
      setMsg(`Poll failed: ${(e as Error).message}`);
    } finally {
      setPolling(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Post Alerts"
        description="When a new company post goes live, automatically nudge staff to go like & comment."
      />

      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--sos-brand-primary-strong, #2563eb)', flexShrink: 0 }}><Info size={17} /></div>
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', lineHeight: 1.6 }}>
            A poller checks our Facebook &amp; Instagram for new posts and alerts the chosen teams once per post. Only posts published <strong>after</strong> you switch this on will alert — turning it on never blasts the back-catalogue. The comments staff then leave are what the <strong>Team Engagement</strong> verifier confirms.
          </div>
        </div>
      </GlassCard>

      {error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#b91c1c' }}><AlertTriangle size={18} /><span>{error}</span></div>
        </GlassCard>
      ) : null}
      {msg ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--sos-text-secondary,#4b5563)' }}><CheckCircle2 size={16} style={{ color: '#059669' }} /> {msg}</div>
        </GlassCard>
      ) : null}

      {loading || !cfg ? (
        <GlassCard variant="default"><p style={{ margin: 0, color: 'var(--sos-text-tertiary,#6b7280)' }}>Loading…</p></GlassCard>
      ) : (
        <>
          {/* Master switch */}
          <GlassCard variant="default">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Alerts {cfg.enabled ? 'on' : 'off'}</div>
                <div style={{ fontSize: 12.5, color: 'var(--sos-text-tertiary,#6b7280)' }}>
                  {cfg.enabled ? `Watching since ${cfg.enabledAt ? new Date(cfg.enabledAt).toLocaleString() : '—'}` : 'No alerts are sent while this is off.'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => patch({ enabled: !cfg.enabled }, !cfg.enabled ? 'Alerts enabled.' : 'Alerts disabled.')}
                disabled={saving}
                style={{
                  width: 54, height: 30, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative',
                  background: cfg.enabled ? '#059669' : 'var(--sos-border-subtle, #cbd5e1)', transition: 'background .15s',
                }}
                aria-pressed={cfg.enabled}
                aria-label="Toggle alerts"
              >
                <span style={{ position: 'absolute', top: 3, left: cfg.enabled ? 27 : 3, width: 24, height: 24, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
              </button>
            </div>
          </GlassCard>

          {/* Platforms */}
          <Section title="Platforms" hint="Which accounts to watch. None selected = both.">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PLATFORMS.map((p) => {
                const on = cfg.platforms.includes(p);
                return <Chip key={p} label={p === 'FACEBOOK' ? 'Facebook' : 'Instagram'} on={on} onClick={() => patch({ platforms: toggle(cfg.platforms, p) })} />;
              })}
            </div>
          </Section>

          {/* Channels */}
          <Section title="Channels" hint="How staff are notified. None selected = all three.">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CHANNELS.map(({ key, label, icon: Icon }) => {
                const on = cfg.channels.includes(key);
                return (
                  <Chip key={key} label={label} icon={<Icon size={13} />} on={on} onClick={() => patch({ channels: toggle(cfg.channels, key) })} />
                );
              })}
            </div>
          </Section>

          {/* Departments */}
          <Section title="Who gets alerted" hint="Pick the teams. None selected = everyone in every active department.">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {cfg.availableDepartments.length === 0 ? (
                <span style={{ fontSize: 12.5, color: 'var(--sos-text-tertiary,#6b7280)' }}>No departments found.</span>
              ) : (
                cfg.availableDepartments.map((d) => (
                  <Chip key={d} label={d} on={cfg.departments.includes(d)} onClick={() => patch({ departments: toggle(cfg.departments, d) })} />
                ))
              )}
            </div>
          </Section>

          {/* Quiet hours */}
          <Section title="Quiet hours (optional)" hint="Posts during this window are held and alert once it ends. Times are PKT.">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <HourSelect label="From" value={cfg.quietStartHour} onChange={(v) => patch({ quietStartHour: v })} />
              <HourSelect label="To" value={cfg.quietEndHour} onChange={(v) => patch({ quietEndHour: v })} />
              {cfg.quietStartHour !== null || cfg.quietEndHour !== null ? (
                <button type="button" onClick={() => patch({ quietStartHour: null, quietEndHour: null })} style={linkBtn}>Clear</button>
              ) : null}
            </div>
          </Section>

          <div>
            <button type="button" onClick={onPoll} disabled={polling} style={btnGhost}>
              <RefreshCw size={14} style={polling ? { animation: 'spin 1s linear infinite' } : undefined} />
              {polling ? 'Polling…' : 'Poll now'}
            </button>
          </div>

          {/* Recent alerts */}
          <GlassCard variant="default">
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Recent alerts</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={th}>When</th>
                    <th style={th}>Platform</th>
                    <th style={th}>Post</th>
                    <th style={{ ...th, textAlign: 'right' }}>Recipients</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id}>
                      <td style={{ ...cell, color: 'var(--sos-text-tertiary,#6b7280)' }}>{r.alertedAt ? new Date(r.alertedAt).toLocaleString() : '—'}</td>
                      <td style={cell}>{r.platform === 'INSTAGRAM' ? 'Instagram' : 'Facebook'}</td>
                      <td style={cell}>
                        {r.permalink ? (
                          <a href={r.permalink} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>{(r.caption ?? r.externalId).slice(0, 48)}</a>
                        ) : (
                          (r.caption ?? r.externalId).slice(0, 48)
                        )}
                      </td>
                      <td style={{ ...cell, textAlign: 'right' }}>{r.recipients}</td>
                    </tr>
                  ))}
                  {recent.length === 0 ? (
                    <tr><td colSpan={4} style={{ ...cell, textAlign: 'center', color: 'var(--sos-text-tertiary,#6b7280)', padding: 18 }}>No alerts sent yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <GlassCard variant="default">
      <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--sos-text-tertiary,#6b7280)', margin: '2px 0 10px' }}>{hint}</div>
      {children}
    </GlassCard>
  );
}

function Chip({ label, on, onClick, icon }: { label: string; on: boolean; onClick: () => void; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer',
        border: `1px solid ${on ? 'var(--sos-brand-primary-strong, #2563eb)' : 'var(--sos-border-subtle, rgba(0,0,0,0.12))'}`,
        background: on ? 'var(--sos-brand-primary-strong, #2563eb)' : 'var(--sos-surface, #fff)',
        color: on ? '#fff' : 'var(--sos-text-secondary, #4b5563)',
      }}
    >
      {icon} {label}
    </button>
  );
}

function HourSelect({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--sos-text-secondary,#4b5563)' }}>
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="sos-select"
        style={{ fontSize: 13, padding: '6px 8px', width: 90 }}
      >
        <option value="">—</option>
        {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
      </select>
    </label>
  );
}

const cell: React.CSSProperties = { padding: '9px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))' };
const th: React.CSSProperties = { padding: '8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--sos-text-tertiary, #6b7280)' };
const btnGhost: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.12))', background: 'var(--sos-surface, #fff)', color: 'var(--sos-text-secondary, #4b5563)', fontSize: 13, fontWeight: 500, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { background: 'transparent', border: 'none', color: '#2563eb', fontSize: 12.5, cursor: 'pointer', padding: 0 };
