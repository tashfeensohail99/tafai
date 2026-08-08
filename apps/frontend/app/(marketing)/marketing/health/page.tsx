'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, MinusCircle, RefreshCw, XCircle } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import { getMarketingHealth, type HealthPipeStatus, type MarketingHealth } from '@/lib/marketing';

const STATUS_STYLES: Record<HealthPipeStatus, { color: string; bg: string; border: string; icon: typeof CheckCircle2; label: string }> = {
  healthy: { color: '#15803d', bg: 'rgba(22,163,74,0.10)',  border: 'rgba(22,163,74,0.30)',  icon: CheckCircle2, label: 'Healthy' },
  warning: { color: '#b45309', bg: 'rgba(217,119,6,0.10)',  border: 'rgba(217,119,6,0.30)',  icon: AlertTriangle, label: 'Warning' },
  stale:   { color: '#b45309', bg: 'rgba(217,119,6,0.15)',  border: 'rgba(217,119,6,0.35)',  icon: AlertTriangle, label: 'Stale' },
  error:   { color: '#b91c1c', bg: 'rgba(220,38,38,0.10)',  border: 'rgba(220,38,38,0.30)',  icon: XCircle, label: 'Error' },
  never:   { color: '#6b7280', bg: 'rgba(107,114,128,0.08)',border: 'rgba(107,114,128,0.20)',icon: MinusCircle, label: 'No data' },
};

export default function MarketingHealthPage() {
  const [data, setData] = useState<MarketingHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMarketingHealth()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Integration Health"
        description="One-look status of every pipe that feeds the Marketing module — Meta syncs, WhatsApp webhook, CTWA lead flow, ad-routing snapshot. Everything is derived live; nothing cached from a previous check."
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)' }}>
          {data?.generatedAt ? `Snapshot: ${new Date(data.generatedAt).toLocaleTimeString()}` : ' '}
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.10))',
            borderRadius: 'var(--sos-radius-md, 10px)',
            background: 'transparent',
            color: 'var(--sos-text-secondary, #4b5563)',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#b91c1c' }}>
            <AlertTriangle size={18} />
            <span>Couldn't load health status: {error}</span>
          </div>
        </GlassCard>
      ) : null}

      {/* Meta account line */}
      {data?.metaAccount ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 36,
                height: 36,
                borderRadius: 'var(--sos-radius-md, 10px)',
                background: data.metaAccount.configured ? STATUS_STYLES.healthy.bg : STATUS_STYLES.error.bg,
                color: data.metaAccount.configured ? STATUS_STYLES.healthy.color : STATUS_STYLES.error.color,
                border: `1px solid ${data.metaAccount.configured ? STATUS_STYLES.healthy.border : STATUS_STYLES.error.border}`,
              }}
            >
              <Activity size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Meta ad account</div>
              <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', marginTop: 2 }}>
                {data.metaAccount.configured ? (
                  <>
                    Connected · <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{data.metaAccount.accountId}</span>
                    {data.metaAccount.source ? ` · via ${data.metaAccount.source} token` : null}
                  </>
                ) : (
                  <>Not configured — set the ad account ID under Admin → API Keys (label = act_…)</>
                )}
              </div>
            </div>
          </div>
        </GlassCard>
      ) : null}

      {/* Per-pipe tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {data?.pipes.map((p) => {
          const s = STATUS_STYLES[p.status];
          const Icon = s.icon;
          return (
            <GlassCard key={p.key} variant="default">
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 34,
                    height: 34,
                    borderRadius: 'var(--sos-radius-md, 10px)',
                    background: s.bg,
                    color: s.color,
                    border: `1px solid ${s.border}`,
                    flexShrink: 0,
                  }}
                >
                  <Icon size={17} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{p.label}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: s.color,
                        background: s.bg,
                        padding: '2px 6px',
                        borderRadius: 'var(--sos-radius-pill, 999px)',
                        border: `1px solid ${s.border}`,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', marginTop: 4 }}>
                    {p.detail}
                  </div>
                  {p.facts && p.facts.length > 0 ? (
                    <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                      {p.facts.map((f) => (
                        <span key={f.label} style={{ fontSize: 11, color: 'var(--sos-text-tertiary, #6b7280)' }}>
                          <span style={{ fontWeight: 600, color: 'var(--sos-text-secondary, #4b5563)' }}>{f.value}</span> {f.label.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </GlassCard>
          );
        })}
      </div>

      {loading && !data ? (
        <div style={{ padding: 20, color: 'var(--sos-text-tertiary, #6b7280)' }}>Loading…</div>
      ) : null}
    </div>
  );
}
