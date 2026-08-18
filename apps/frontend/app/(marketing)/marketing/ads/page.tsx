'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import { StatusPill } from '@/components/marketing/StatusPill';
import { WindowPicker } from '@/components/marketing/WindowPicker';
import { fmtMoney, fmtInt, fmtPct, getMarketingAds, type MarketingAd } from '@/lib/marketing';

type SortKey = 'spend' | 'leads' | 'cpl' | 'clicks' | 'impressions';

export default function MarketingAdsPage() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<MarketingAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [includeIdle, setIncludeIdle] = useState(false);
  const [sort, setSort] = useState<SortKey>('spend');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMarketingAds({ days, includeIdle })
      .then((res) => {
        if (!cancelled) setRows(res.ads);
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
  }, [days, includeIdle]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const scoped = needle
      ? rows.filter((r) =>
          [r.adName, r.adsetName, r.campaignName, r.adId, r.campaignId]
            .filter((v): v is string => typeof v === 'string')
            .some((v) => v.toLowerCase().includes(needle)),
        )
      : rows;
    return [...scoped].sort((a, b) => {
      switch (sort) {
        case 'leads': return b.leads - a.leads;
        case 'cpl': return (b.cpl ?? 0) - (a.cpl ?? 0);
        case 'clicks': return b.clicks - a.clicks;
        case 'impressions': return b.impressions - a.impressions;
        default: return b.spend - a.spend;
      }
    });
  }, [rows, q, sort]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Meta Ads"
        description={`Every Meta ad the account has run — its delivery status, spend, leads and CPL over the last ${days} days.`}
      />

      {/* Controls row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
          <Search
            size={14}
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--sos-text-tertiary, #6b7280)' }}
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by ad, ad set, campaign, or id…"
            style={{
              width: '100%',
              padding: '8px 12px 8px 30px',
              fontSize: 13,
              border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.10))',
              borderRadius: 'var(--sos-radius-md, 10px)',
              background: 'var(--sos-surface-primary, #ffffff)',
              color: 'var(--sos-text-primary, #111827)',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)' }}>
            <input type="checkbox" checked={includeIdle} onChange={(e) => setIncludeIdle(e.target.checked)} />
            Include idle
          </label>
          <WindowPicker value={days} onChange={setDays} />
        </div>
      </div>

      {error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#b91c1c' }}>
            <AlertTriangle size={18} />
            <span>Couldn't load ads: {error}</span>
          </div>
        </GlassCard>
      ) : null}

      <GlassCard variant="default">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--sos-text-secondary, #4b5563)' }}>
            {loading ? 'Loading…' : `${filtered.length} ad${filtered.length === 1 ? '' : 's'}${includeIdle ? ' (incl. idle)' : ''}`}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--sos-text-tertiary, #6b7280)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={cellHead}>Ad</th>
                <th style={cellHead}>Status</th>
                <SortableTh label="Spend"   active={sort === 'spend'}   onClick={() => setSort('spend')}   align="right" />
                <SortableTh label="Impr."   active={sort === 'impressions'} onClick={() => setSort('impressions')} align="right" />
                <SortableTh label="Clicks"  active={sort === 'clicks'}  onClick={() => setSort('clicks')}  align="right" />
                <th style={{ ...cellHead, textAlign: 'right' }}>CTR</th>
                <SortableTh label="Leads"   active={sort === 'leads'}   onClick={() => setSort('leads')}   align="right" />
                <SortableTh label="CPL"     active={sort === 'cpl'}     onClick={() => setSort('cpl')}     align="right" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.adId}>
                  <td style={cell}>
                    <div style={{ fontWeight: 500 }}>{r.adName ?? '(unnamed ad)'}</div>
                    <div style={{ fontSize: 11, color: 'var(--sos-text-tertiary, #6b7280)' }}>
                      {r.campaignName ?? r.campaignId} · {r.adsetName ?? r.adsetId}
                    </div>
                  </td>
                  <td style={cell}><StatusPill status={r.effectiveStatus} /></td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmtMoney(r.spend, r.spendCurrency, { compact: true })}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmtInt(r.impressions)}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmtInt(r.clicks)}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmtPct(r.ctr, 2)}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmtInt(r.leads)}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmtMoney(r.cpl, r.spendCurrency)}</td>
                </tr>
              ))}
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)' }}>
                    {rows.length === 0 ? 'No ad activity in this window.' : `No ads match "${q}".`}
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

function SortableTh({
  label,
  active,
  onClick,
  align = 'left',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <th style={{ ...cellHead, textAlign: align, cursor: 'pointer' }} onClick={onClick}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          color: active ? 'var(--sos-brand-primary-strong, #2563eb)' : undefined,
        }}
      >
        {label} {active ? '↓' : ''}
      </span>
    </th>
  );
}
