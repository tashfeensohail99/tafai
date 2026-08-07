'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, DollarSign, Layers, TrendingUp, Users, UserCheck } from 'lucide-react';
import { GlassCard, MetricCard, PageHeader } from '@/components/sales-v2/ui';
import { SpendLeadsChart } from '@/components/marketing/SpendLeadsChart';
import { StatusPill } from '@/components/marketing/StatusPill';
import { WindowPicker } from '@/components/marketing/WindowPicker';
import {
  fmtCad,
  fmtInt,
  fmtNativeAmount,
  fmtPct,
  fmtRoas,
  getMarketingOverview,
  type MarketingOverview,
} from '@/lib/marketing';

export default function MarketingOverviewPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<MarketingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMarketingOverview(days)
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
  }, [days]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Marketing Overview"
        description={`Spend, leads and conversions from every Click-to-WhatsApp ad — attributed to the actual paying client, not just the click. Trailing ${days} days.`}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <WindowPicker value={days} onChange={setDays} />
      </div>

      {error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#b91c1c' }}>
            <AlertTriangle size={18} />
            <span>Couldn't load dashboard: {error}</span>
          </div>
        </GlassCard>
      ) : null}

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <MetricCard
          label="Ad spend"
          value={loading ? '…' : fmtCad(data?.kpis.spendBaseCad ?? 0, { compact: true })}
          tone="accent"
          Icon={DollarSign}
          hint={
            data?.kpis.spendByCurrency.length
              ? data.kpis.spendByCurrency.map((c) => fmtNativeAmount(c.amount, c.currency)).join(' · ')
              : undefined
          }
        />
        <MetricCard label="Leads" value={loading ? '…' : fmtInt(data?.kpis.leads)} tone="info" Icon={Users} hint="Leads from ads" />
        <MetricCard
          label="Cost per lead"
          value={loading ? '…' : fmtCad(data?.kpis.cpl, { compact: true })}
          tone="neutral"
          Icon={TrendingUp}
        />
        <MetricCard
          label="Clients converted"
          value={loading ? '…' : fmtInt(data?.kpis.clientsConverted)}
          tone="success"
          Icon={UserCheck}
          hint={data?.kpis.conversionRate != null ? `${fmtPct(data.kpis.conversionRate)} of leads` : undefined}
        />
        <MetricCard
          label="Revenue (CAD)"
          value={loading ? '…' : fmtCad(data?.kpis.revenueBaseCad ?? 0, { compact: true })}
          tone="success"
          Icon={DollarSign}
          hint={data?.kpis.cpa != null ? `${fmtCad(data.kpis.cpa, { compact: true })} per client` : undefined}
        />
        <MetricCard
          label="ROAS"
          value={loading ? '…' : fmtRoas(data?.kpis.roas)}
          tone={(data?.kpis.roas ?? 0) >= 1 ? 'success' : 'warning'}
          Icon={TrendingUp}
          hint="Revenue / spend"
        />
      </div>

      {/* Chart */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Daily spend vs leads</div>
              <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)' }}>
                {data ? `${data.window.from} → ${data.window.to}` : '—'}
              </div>
            </div>
          </div>
          {data && data.timeSeries.length > 0 ? (
            <SpendLeadsChart points={data.timeSeries} />
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)' }}>
              {loading ? 'Loading…' : 'No data for this window'}
            </div>
          )}
        </div>
      </GlassCard>

      {/* Top campaigns */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Top campaigns by spend</div>
              <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)' }}>Trailing {days} days</div>
            </div>
            <Link
              href="/marketing/campaigns"
              style={{ fontSize: 12, color: 'var(--sos-brand-primary-strong, #2563eb)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Layers size={14} /> All campaigns →
            </Link>
          </div>
          <TopCampaignsTable data={data} loading={loading} />
        </div>
      </GlassCard>
    </div>
  );
}

function TopCampaignsTable({ data, loading }: { data: MarketingOverview | null; loading: boolean }) {
  if (loading && !data) {
    return <div style={{ padding: 20, color: 'var(--sos-text-tertiary, #6b7280)' }}>Loading…</div>;
  }
  if (!data || data.topCampaigns.length === 0) {
    return <div style={{ padding: 20, color: 'var(--sos-text-tertiary, #6b7280)' }}>No campaigns had activity in this window.</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--sos-text-tertiary, #6b7280)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <th style={{ padding: '8px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))' }}>Campaign</th>
            <th style={{ padding: '8px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))' }}>Status</th>
            <th style={{ padding: '8px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))', textAlign: 'right' }}>Spend</th>
            <th style={{ padding: '8px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))', textAlign: 'right' }}>Leads</th>
            <th style={{ padding: '8px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))', textAlign: 'right' }}>CPL</th>
          </tr>
        </thead>
        <tbody>
          {data.topCampaigns.map((c) => (
            <tr key={c.campaignId}>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))' }}>
                <div style={{ fontWeight: 500 }}>{c.name ?? '(unnamed campaign)'}</div>
                <div style={{ fontSize: 11, color: 'var(--sos-text-tertiary, #6b7280)' }}>{c.campaignId}</div>
              </td>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))' }}>
                <StatusPill status={c.effectiveStatus} />
              </td>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))', textAlign: 'right' }}>
                {fmtCad(c.spendBaseCad, { compact: true })}
              </td>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))', textAlign: 'right' }}>{fmtInt(c.leads)}</td>
              <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))', textAlign: 'right' }}>{fmtCad(c.cpl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
