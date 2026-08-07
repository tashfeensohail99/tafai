'use client';

import { Activity, Bell, Filter, Layers, Megaphone, Split, Sparkles, TrendingUp } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';

const SECTIONS: Array<{ icon: typeof Megaphone; title: string; body: string }> = [
  { icon: Megaphone, title: 'Meta Ads', body: 'Every ad with status, spend, leads, CPL and its lead-routing destination.' },
  { icon: Layers, title: 'Campaigns', body: 'The Campaign → Ad Set → Ad hierarchy, synced hourly from Meta.' },
  { icon: Split, title: 'Lead Routing', body: 'Point each ad or campaign at Islamabad, Lahore or Both — no developer needed.' },
  { icon: TrendingUp, title: 'Performance', body: 'CPL, CTR, CPC, CPM and ROAS by ad, current period vs previous.' },
  { icon: Filter, title: 'Conversions', body: 'The funnel from ad → lead → qualified → paid client. (Later phase.)' },
  { icon: Sparkles, title: 'AI Insights', body: 'Structured, advisory recommendations — never auto-changes budgets or ads.' },
  { icon: Bell, title: 'Alerts', body: 'Ad rejected, spending with no leads, CPL spiking, new ad detected.' },
  { icon: Activity, title: 'Integration Health', body: 'Meta connection, last sync, last lead received, webhook status.' },
];

export default function MarketingOverviewPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Marketing Overview"
        description="Meta ads, campaigns, lead routing and analytics — connected to the CRM so you can see what each advertisement actually produced, not just clicks."
      />

      <GlassCard variant="default">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--sos-brand-primary-strong)',
              background: 'var(--sos-brand-primary-soft)',
              border: '1px solid var(--sos-brand-primary-border)',
              borderRadius: 'var(--sos-radius-pill)',
              padding: '4px 11px',
              whiteSpace: 'nowrap',
            }}
          >
            Phase 1A
          </div>
          <p style={{ margin: 0, color: 'var(--sos-text-secondary)', fontSize: 14, lineHeight: 1.65 }}>
            This is the foundation: the Marketing role, login and portal are live. The data screens below
            fill in over the next phases — starting with durable ad→lead attribution (so a lead never loses
            the ad that produced it), then the campaign hierarchy sync, dashboards, editable routing, alerts
            and AI insights. Everything reads Meta data the CRM already collects from Click-to-WhatsApp ads.
          </p>
        </div>
      </GlassCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {SECTIONS.map((s) => (
          <GlassCard key={s.title} variant="default">
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 38,
                  height: 38,
                  flexShrink: 0,
                  borderRadius: 'var(--sos-radius-button)',
                  background: 'var(--sos-brand-primary-soft)',
                  color: 'var(--sos-brand-primary-strong)',
                }}
              >
                <s.icon size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: 3 }}>{s.title}</div>
                <div style={{ fontSize: 13, color: 'var(--sos-text-secondary)', lineHeight: 1.55 }}>{s.body}</div>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
