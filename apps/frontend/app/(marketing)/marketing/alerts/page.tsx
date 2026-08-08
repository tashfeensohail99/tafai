'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import { getMarketingAlerts, type MarketingAlert, type MarketingAlertSeverity } from '@/lib/marketing';

const SEVERITY_STYLES: Record<MarketingAlertSeverity, { bg: string; color: string; border: string; icon: typeof AlertCircle }> = {
  critical: { bg: 'rgba(220,38,38,0.10)', color: '#b91c1c', border: 'rgba(220,38,38,0.30)', icon: AlertCircle },
  warning:  { bg: 'rgba(217,119,6,0.10)', color: '#b45309', border: 'rgba(217,119,6,0.30)', icon: AlertTriangle },
  info:     { bg: 'rgba(37,99,235,0.08)', color: '#1d4ed8', border: 'rgba(37,99,235,0.25)', icon: Info },
};

export default function MarketingAlertsPage() {
  const [alerts, setAlerts] = useState<MarketingAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMarketingAlerts()
      .then((res) => {
        if (!cancelled) setAlerts(res);
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

  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, info: 0 } as Record<MarketingAlertSeverity, number>;
    for (const a of alerts) c[a.severity] += 1;
    return c;
  }, [alerts]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Alerts"
        description="Conditions that need your attention — computed live from Meta and CRM data. An alert vanishes automatically the moment the underlying condition clears."
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 14, fontSize: 13, color: 'var(--sos-text-secondary, #4b5563)' }}>
          <CountChip label="Critical" count={counts.critical} severity="critical" />
          <CountChip label="Warning" count={counts.warning} severity="warning" />
          <CountChip label="Info" count={counts.info} severity="info" />
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
            <span>Couldn't load alerts: {error}</span>
          </div>
        </GlassCard>
      ) : null}

      {!loading && alerts.length === 0 && !error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 8 }}>
            <CheckCircle2 size={22} color="#15803d" />
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>All clear</div>
              <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)' }}>
                No ads are disapproved, spending without leads, spiking on CPL, or missing a routing rule.
              </div>
            </div>
          </div>
        </GlassCard>
      ) : null}

      {loading && alerts.length === 0 && !error ? (
        <GlassCard variant="default">
          <div style={{ padding: 20, color: 'var(--sos-text-tertiary, #6b7280)' }}>Loading…</div>
        </GlassCard>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {alerts.map((a) => (
          <AlertCard key={a.key} alert={a} />
        ))}
      </div>
    </div>
  );
}

function CountChip({ label, count, severity }: { label: string; count: number; severity: MarketingAlertSeverity }) {
  const s = SEVERITY_STYLES[severity];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 'var(--sos-radius-pill, 999px)',
        fontSize: 12,
        fontWeight: 600,
        color: s.color,
        background: count > 0 ? s.bg : 'transparent',
        border: `1px solid ${count > 0 ? s.border : 'var(--sos-border-subtle, rgba(0,0,0,0.10))'}`,
        opacity: count > 0 ? 1 : 0.55,
      }}
    >
      {label} · {count}
    </span>
  );
}

function AlertCard({ alert }: { alert: MarketingAlert }) {
  const s = SEVERITY_STYLES[alert.severity];
  const Icon = s.icon;

  const actionHref = actionLinkFor(alert);

  return (
    <GlassCard variant="default">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 36,
            height: 36,
            borderRadius: 'var(--sos-radius-md, 10px)',
            background: s.bg,
            color: s.color,
            border: `1px solid ${s.border}`,
            flexShrink: 0,
          }}
        >
          <Icon size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: s.color,
                background: s.bg,
                padding: '2px 7px',
                borderRadius: 'var(--sos-radius-pill, 999px)',
                border: `1px solid ${s.border}`,
              }}
            >
              {alert.type.replace(/_/g, ' ')}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{alert.title}</span>
            {alert.campaignName ? (
              <span style={{ fontSize: 12, color: 'var(--sos-text-tertiary, #6b7280)' }}>· {alert.campaignName}</span>
            ) : null}
          </div>
          <div style={{ fontSize: 13, color: 'var(--sos-text-secondary, #4b5563)', marginTop: 4, lineHeight: 1.5 }}>
            {alert.description}
          </div>
          {alert.metric || alert.adId || actionHref ? (
            <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'center', fontSize: 12, flexWrap: 'wrap' }}>
              {alert.metric ? (
                <span style={{ color: 'var(--sos-text-secondary, #4b5563)' }}>
                  <span style={{ fontWeight: 600 }}>{alert.metric.label}:</span> {alert.metric.value}
                </span>
              ) : null}
              {alert.adId ? (
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: 'var(--sos-text-tertiary, #6b7280)' }}>
                  ad {alert.adId}
                </span>
              ) : null}
              {actionHref ? (
                <Link href={actionHref} style={{ color: 'var(--sos-brand-primary-strong, #2563eb)', textDecoration: 'none', fontWeight: 600 }}>
                  {actionLabelFor(alert.type)} →
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </GlassCard>
  );
}

function actionLinkFor(a: MarketingAlert): string | null {
  if (a.type === 'NEW_UNROUTED_AD') return '/marketing/routing';
  if (a.adId) return `/marketing/ads`;
  return null;
}

function actionLabelFor(t: MarketingAlert['type']): string {
  if (t === 'NEW_UNROUTED_AD') return 'Add routing rule';
  return 'Open Ads';
}
