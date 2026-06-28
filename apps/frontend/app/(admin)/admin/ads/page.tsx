'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Banknote,
  Eye,
  Loader2,
  Megaphone,
  MousePointerClick,
  RefreshCw,
  Users,
} from 'lucide-react';
import {
  GhostButton,
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
  type MetricTone,
} from '@/components/sales-v2/ui';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useAdminSession } from '@/components/layout/AdminShell';
import {
  fetchAdPerformance,
  type AdPerformanceRow,
  type MoneyByCurrency,
} from '@/lib/leads-admin';

function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return `${Math.round(n)}`;
}
function fmtInt(n?: number | null): string {
  return n == null ? '—' : Math.round(n).toLocaleString();
}
function fmtMoney(rows: MoneyByCurrency[]): string {
  if (rows.length === 0) return '—';
  return rows
    .map((r) => `${r.currency === 'PKR' ? 'Rs ' : `${r.currency} `}${compactNum(r.amount)}`)
    .join(' + ');
}
/** Precise single amount + currency for per-row cost figures (no k-rounding). */
function fmtAmt(amount?: number | null, currency?: string | null): string {
  if (amount == null) return '—';
  const sym = currency === 'PKR' ? 'Rs ' : currency ? `${currency} ` : '';
  const n =
    Math.abs(amount) >= 1000
      ? Math.round(amount).toLocaleString()
      : (Math.round(amount * 100) / 100).toLocaleString();
  return `${sym}${n}`;
}
function adName(row: AdPerformanceRow): string {
  if (row.headline && row.headline.trim()) return row.headline.trim();
  if (row.sourceType) return `${row.sourceType} ad`;
  if (row.sourceId) return `Ad ${row.sourceId}`;
  return 'Untitled ad';
}

/** Local YYYY-MM-DD (date-granular; matches the backend's calendar-day window). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}
function startOfMonth(): string {
  const d = new Date();
  return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
}
const TODAY = (): string => ymd(new Date());

const th: CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--sos-text-faint)',
  borderBottom: '1px solid var(--sos-border-subtle)',
  whiteSpace: 'nowrap',
};
const td: CSSProperties = {
  padding: '11px 14px',
  fontSize: 13,
  color: 'var(--sos-text-secondary)',
  borderBottom: '1px solid var(--sos-border-subtle)',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
};

interface Preset {
  key: string;
  label: string;
  from: () => string;
  to: () => string;
}
const PRESETS: Preset[] = [
  { key: '7d', label: 'Last 7 days', from: () => daysAgo(6), to: TODAY },
  { key: '30d', label: 'Last 30 days', from: () => daysAgo(29), to: TODAY },
  { key: '90d', label: 'Last 90 days', from: () => daysAgo(89), to: TODAY },
  { key: 'month', label: 'This month', from: startOfMonth, to: TODAY },
];

export default function AdsPage() {
  const { user } = useAdminSession();
  const canView = user.permissions.includes('leads.view_all');

  const [from, setFrom] = useState<string>(() => daysAgo(29));
  const [to, setTo] = useState<string>(() => TODAY());
  const [ads, setAds] = useState<AdPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activePreset = useMemo(
    () => PRESETS.find((p) => p.from() === from && p.to() === to)?.key ?? null,
    [from, to],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAds(await fetchAdPerformance({ from, to }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ad performance');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    if (canView) void reload();
  }, [canView, reload]);

  const spentAds = useMemo(
    () => ads.filter((a) => a.spend != null).sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0)),
    [ads],
  );

  const blended = useMemo(() => {
    const cur = spentAds.find((a) => a.spendCurrency)?.spendCurrency ?? null;
    const spendByCur = new Map<string, number>();
    let spendNative = 0;
    let impressions = 0;
    let clicks = 0;
    let leads = 0;
    for (const a of spentAds) {
      const c = a.spendCurrency ?? cur ?? 'PKR';
      spendByCur.set(c, (spendByCur.get(c) ?? 0) + (a.spend ?? 0));
      spendNative += a.spend ?? 0;
      impressions += a.impressions ?? 0;
      clicks += a.clicks ?? 0;
      leads += a.leads30 ?? 0;
    }
    const spend: MoneyByCurrency[] = [...spendByCur.entries()]
      .map(([currency, amount]) => ({ currency, amount: Math.round(amount) }))
      .sort((x, y) => y.amount - x.amount);
    return {
      cur,
      spend,
      impressions,
      clicks,
      leads,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null,
      cpc: clicks > 0 ? Math.round((spendNative / clicks) * 100) / 100 : null,
      cpl: leads > 0 ? Math.round((spendNative / leads) * 100) / 100 : null,
    };
  }, [spentAds]);

  if (!canView) {
    return <PermissionDeniedState message="You need the leads.view_all permission to view ad performance." />;
  }

  const kpis: Array<{ label: string; value: string; hint: string; tone: MetricTone; Icon: typeof Eye }> = [
    { label: 'Ad spend', value: fmtMoney(blended.spend), hint: 'Meta spend in this range', tone: 'warning', Icon: Banknote },
    { label: 'Impressions', value: fmtInt(blended.impressions), hint: 'Times your ads were shown', tone: 'info', Icon: Eye },
    { label: 'Clicks', value: fmtInt(blended.clicks), hint: 'Taps to WhatsApp', tone: 'info', Icon: MousePointerClick },
    { label: 'Click-through rate', value: blended.ctr != null ? `${blended.ctr}%` : '—', hint: 'Clicks ÷ impressions', tone: 'accent', Icon: MousePointerClick },
    { label: 'Cost / click', value: fmtAmt(blended.cpc, blended.cur), hint: 'Spend ÷ clicks', tone: 'warm', Icon: Banknote },
    { label: 'Leads', value: fmtInt(blended.leads), hint: 'Leads these ads brought', tone: 'success', Icon: Users },
    { label: 'Cost / lead', value: fmtAmt(blended.cpl, blended.cur), hint: 'Spend ÷ leads', tone: 'success', Icon: Banknote },
  ];

  const dateInput: CSSProperties = { width: 150 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="CRM · Marketing"
        title="Ads Performance"
        description="What you spent on Meta ads and the leads it brought. Spend, impressions and clicks come from the Meta Marketing API; leads are Click-to-WhatsApp leads attributed to each ad in the selected range."
        actions={
          <GhostButton iconLeft={<RefreshCw size={14} />} onClick={() => void reload()}>
            Refresh
          </GhostButton>
        }
      />

      {/* Date-range picker: presets + custom calendar */}
      <GlassCard variant="soft" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => { setFrom(p.from()); setTo(p.to()); }}
                className={activePreset === p.key ? 'sos-chip sos-chip--active' : 'sos-chip'}
                style={{
                  cursor: 'pointer',
                  padding: '6px 12px',
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: '1px solid var(--sos-border-subtle)',
                  background: activePreset === p.key ? 'var(--sos-brand-primary)' : 'var(--sos-surface-1)',
                  color: activePreset === p.key ? '#fff' : 'var(--sos-text-secondary)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <span className="sos-text-faint" style={{ fontSize: 12 }}>From</span>
            <input type="date" className="sos-input" style={dateInput} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <span className="sos-text-faint" style={{ fontSize: 12 }}>to</span>
            <input type="date" className="sos-input" style={dateInput} value={to} min={from} max={TODAY()} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </GlassCard>

      {error ? <div className="sos-banner sos-banner--danger">{error}</div> : null}

      {/* Headline funnel KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        {kpis.map((k) => (
          <MetricCard key={k.label} label={k.label} value={k.value} hint={k.hint} tone={k.tone} Icon={k.Icon} />
        ))}
      </div>

      {/* Per-ad funnel */}
      <GlassCard variant="default" padded={false} glow="warm">
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Megaphone size={16} style={{ color: 'var(--sos-brand-accent)' }} />
          <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>Per-ad funnel</h2>
          <span className="sos-text-faint" style={{ fontSize: 12 }}>
            Spend → Impressions → Clicks → Leads, per ad · {from} → {to}. Biggest spenders first.
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <StatusBadge tone="warm" size="sm" dot={false}>{spentAds.length} ads</StatusBadge>
          </span>
        </div>

        {loading ? (
          <div className="sos-text-muted" style={{ padding: 22, textAlign: 'center' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading…
          </div>
        ) : spentAds.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 22, textAlign: 'center', fontSize: 13 }}>
            No ad spend in this range. Spend syncs for roughly the last 90 days; pick a more recent range, or connect a Meta ad account in Settings → API Keys (Meta Ads).
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
              <thead>
                <tr>
                  <th style={th}>Ad</th>
                  <th style={th}>Spend</th>
                  <th style={th}>Impressions</th>
                  <th style={th}>Clicks</th>
                  <th style={th}>CTR</th>
                  <th style={th}>Cost / click</th>
                  <th style={th}>Leads</th>
                  <th style={th}>Cost / lead</th>
                </tr>
              </thead>
              <tbody>
                {spentAds.map((row, i) => (
                  <tr key={`${row.sourceId ?? 'none'}-${i}`}>
                    <td style={{ ...td, maxWidth: 280, whiteSpace: 'normal' }}>
                      <div style={{ fontWeight: 600, color: 'var(--sos-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {adName(row)}
                      </div>
                      <div className="sos-text-faint" style={{ fontSize: 11, marginTop: 2 }}>
                        {row.sourceType ?? 'ad'}{row.sourceId ? ` · ${row.sourceId}` : ''}
                      </div>
                    </td>
                    <td style={{ ...td, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{fmtAmt(row.spend, row.spendCurrency)}</td>
                    <td style={td}>{fmtInt(row.impressions)}</td>
                    <td style={td}>{fmtInt(row.clicks)}</td>
                    <td style={td}>{row.ctr != null ? `${row.ctr}%` : '—'}</td>
                    <td style={td}>{fmtAmt(row.cpc, row.spendCurrency)}</td>
                    <td style={{ ...td, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{fmtInt(row.leads30)}</td>
                    <td style={td}>{fmtAmt(row.cpl, row.spendCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
