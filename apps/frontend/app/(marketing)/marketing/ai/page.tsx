'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Info, Layers, Megaphone, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import {
  getMarketingInsights,
  refreshMarketingInsights,
  type InsightCategory,
  type InsightSeverity,
  type MarketingInsight,
  type MarketingInsightsResult,
} from '@/lib/marketing';

const SEVERITY_STYLES: Record<InsightSeverity, { color: string; bg: string; border: string; label: string }> = {
  high:   { color: '#b91c1c', bg: 'rgba(220,38,38,0.10)',  border: 'rgba(220,38,38,0.30)',  label: 'High priority' },
  medium: { color: '#b45309', bg: 'rgba(217,119,6,0.10)',  border: 'rgba(217,119,6,0.30)',  label: 'Medium' },
  low:    { color: '#1d4ed8', bg: 'rgba(37,99,235,0.08)',  border: 'rgba(37,99,235,0.25)',  label: 'Low' },
};

const CATEGORY_LABEL: Record<InsightCategory, string> = {
  performance: 'Performance',
  attribution: 'Attribution',
  routing: 'Routing',
  creative: 'Creative',
  budget: 'Budget',
  other: 'Other',
};

const SEV_ORDER: Record<InsightSeverity, number> = { high: 0, medium: 1, low: 2 };

export default function MarketingAiInsightsPage() {
  const [data, setData] = useState<MarketingInsightsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMarketingInsights(30)
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
  }, []);

  const doRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await refreshMarketingInsights(30);
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const sorted = useMemo(
    () => (data ? [...data.insights].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) : []),
    [data],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="AI Insights"
        description="A senior media-analyst read of your last 30 days — patterns worth acting on, ranked by impact. Regenerates on demand."
      />

      {/* Non-negotiable advisory banner (spec §15). Always visible. */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ color: '#b45309', flexShrink: 0 }}>
            <ShieldAlert size={20} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', lineHeight: 1.55 }}>
            <strong style={{ color: 'var(--sos-text-primary, #111827)' }}>Advisory only.</strong> Nothing on this page changes budgets,
            pauses ads, or edits routing. Every recommendation is a suggestion for you to accept or ignore — the AI cannot act on
            your Meta account or the CRM.
          </div>
        </div>
      </GlassCard>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)' }}>
          {data ? (
            <>
              Generated {new Date(data.generatedAt).toLocaleString()} · model {data.model}
              {data.cached ? ' · cached' : ''}
              {data.tokens ? ` · ${data.tokens.input + data.tokens.output} tokens` : ''}
            </>
          ) : (
            ' '
          )}
        </div>
        <button
          type="button"
          onClick={doRefresh}
          disabled={loading || refreshing}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 600,
            border: '1px solid var(--sos-brand-primary-border, rgba(37,99,235,0.30))',
            borderRadius: 'var(--sos-radius-md, 10px)',
            background: 'var(--sos-brand-primary-strong, #2563eb)',
            color: '#ffffff',
            cursor: loading || refreshing ? 'wait' : 'pointer',
            opacity: loading || refreshing ? 0.7 : 1,
          }}
        >
          <RefreshCw size={13} className={refreshing ? 'sos-spin' : undefined} />
          {refreshing ? 'Generating…' : 'Regenerate'}
        </button>
      </div>

      {error || data?.error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: '#b91c1c' }}>
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <div style={{ fontSize: 13 }}>
              {error ?? data?.error}
              {data?.error?.toLowerCase().includes('key') ? (
                <div style={{ fontSize: 12, marginTop: 6, color: 'var(--sos-text-secondary, #4b5563)' }}>
                  Set an OpenAI key under Admin → API Keys (label: <code>openai</code>) and try again.
                </div>
              ) : null}
            </div>
          </div>
        </GlassCard>
      ) : null}

      {loading && !data ? (
        <GlassCard variant="default">
          <div style={{ padding: 24, color: 'var(--sos-text-tertiary, #6b7280)', display: 'flex', gap: 10, alignItems: 'center' }}>
            <Sparkles size={16} />
            <span>Reading the last 30 days…</span>
          </div>
        </GlassCard>
      ) : null}

      {data && !data.error && sorted.length === 0 && !loading ? (
        <GlassCard variant="default">
          <div style={{ padding: 20, color: 'var(--sos-text-tertiary, #6b7280)' }}>
            No insights this window. Either everything looks steady, or there isn't enough activity yet to draw a line.
          </div>
        </GlassCard>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sorted.map((i) => (
          <InsightCard key={i.key} insight={i} />
        ))}
      </div>

      <style jsx>{`
        :global(.sos-spin) {
          animation: sos-spin 700ms linear infinite;
        }
        @keyframes sos-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function InsightCard({ insight }: { insight: MarketingInsight }) {
  const s = SEVERITY_STYLES[insight.severity];
  const catLabel = CATEGORY_LABEL[insight.category] ?? 'Other';

  const deepLink =
    insight.category === 'routing'
      ? '/marketing/routing'
      : insight.targetAdId
      ? '/marketing/ads'
      : insight.targetCampaignId
      ? '/marketing/campaigns'
      : null;

  return (
    <GlassCard variant="default">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: s.color,
              background: s.bg,
              padding: '2px 8px',
              borderRadius: 'var(--sos-radius-pill, 999px)',
              border: `1px solid ${s.border}`,
            }}
          >
            {s.label}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '2px 8px',
              borderRadius: 'var(--sos-radius-pill, 999px)',
              background: 'var(--sos-surface-subtle, rgba(0,0,0,0.04))',
              color: 'var(--sos-text-secondary, #4b5563)',
              border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))',
            }}
          >
            {catLabel}
          </span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{insight.title}</span>
        </div>

        <div style={{ fontSize: 13, color: 'var(--sos-text-secondary, #4b5563)', lineHeight: 1.55 }}>
          {insight.rationale}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingTop: 4 }}>
          <div style={{ color: 'var(--sos-brand-primary-strong, #2563eb)', flexShrink: 0, marginTop: 2 }}>
            <Info size={14} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--sos-text-primary, #111827)' }}>
            <strong style={{ marginRight: 6 }}>Recommended action:</strong>
            {insight.action}
          </div>
        </div>

        {(insight.targetAdName || insight.targetCampaignName || deepLink) ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4, flexWrap: 'wrap', fontSize: 12, color: 'var(--sos-text-tertiary, #6b7280)' }}>
            {insight.targetAdName ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Megaphone size={12} /> {insight.targetAdName}
              </span>
            ) : null}
            {insight.targetCampaignName ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Layers size={12} /> {insight.targetCampaignName}
              </span>
            ) : null}
            <span>Confidence {(insight.confidence * 100).toFixed(0)}%</span>
            {deepLink ? (
              <Link href={deepLink} style={{ color: 'var(--sos-brand-primary-strong, #2563eb)', textDecoration: 'none', fontWeight: 600, marginLeft: 'auto' }}>
                Open →
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </GlassCard>
  );
}
