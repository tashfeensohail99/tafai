'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Search } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import { StatusPill } from '@/components/marketing/StatusPill';
import { WindowPicker } from '@/components/marketing/WindowPicker';
import {
  fmtInt,
  fmtPct,
  getMarketingLeadsByAd,
  type MarketingLeadsByAdRow,
} from '@/lib/marketing';

type SortKey = 'roas' | 'conversations' | 'clients' | 'convRate';

export default function MarketingLeadsPage() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<MarketingLeadsByAdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [includeIdle, setIncludeIdle] = useState(false);
  const [sort, setSort] = useState<SortKey>('roas');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMarketingLeadsByAd({ days, includeIdle })
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
          [r.adName, r.campaignName, r.adId]
            .filter((v): v is string => typeof v === 'string')
            .some((v) => v.toLowerCase().includes(needle)),
        )
      : rows;
    return [...scoped].sort((a, b) => {
      switch (sort) {
        case 'conversations': return b.conversations - a.conversations;
        case 'clients':       return b.clientsConverted - a.clientsConverted;
        case 'convRate':      return (b.conversionRate ?? 0) - (a.conversionRate ?? 0);
        default:              return (b.roas ?? 0) - (a.roas ?? 0);
      }
    });
  }, [rows, q, sort]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          conversations: acc.conversations + r.conversations,
          clients: acc.clients + r.clientsConverted,
        }),
        { conversations: 0, clients: 0 },
      ),
    [rows],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Leads by ad"
        description={`Conversations and return on ad spend for every Meta ad in the last ${days} days. Aggregated at the ad level — no individual lead details, no absolute amounts.`}
      />

      {/* Aggregate-only privacy note */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--sos-brand-primary-strong, #2563eb)', flexShrink: 0 }}>
            <Info size={17} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', lineHeight: 1.55 }}>
            <strong style={{ color: 'var(--sos-text-primary, #111827)' }}>Aggregate view.</strong>{' '}
            One row per ad — conversations, clients converted, and return on ad spend as a percentage. Individual lead
            details and absolute money amounts are not shown here.
          </div>
        </div>
      </GlassCard>

      {/* Controls */}
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
            placeholder="Search by ad or campaign name…"
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
            <span>Couldn&apos;t load: {error}</span>
          </div>
        </GlassCard>
      ) : null}

      <GlassCard variant="default">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 13, color: 'var(--sos-text-secondary, #4b5563)' }}>
            {loading ? 'Loading…' : `${filtered.length} ad${filtered.length === 1 ? '' : 's'}${includeIdle ? ' (incl. idle)' : ''}`}
          </div>
          {!loading && rows.length > 0 ? (
            <div style={{ fontSize: 12, color: 'var(--sos-text-tertiary, #6b7280)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span><strong>{fmtInt(totals.conversations)}</strong> conversations</span>
              <span><strong>{fmtInt(totals.clients)}</strong> clients</span>
            </div>
          ) : null}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 780 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--sos-text-tertiary, #6b7280)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={cellHead}>Ad</th>
                <th style={cellHead}>Status</th>
                <SortableTh label="Conversations" active={sort === 'conversations'} onClick={() => setSort('conversations')} />
                <SortableTh label="Clients"       active={sort === 'clients'}       onClick={() => setSort('clients')} />
                <SortableTh label="Conv. rate"    active={sort === 'convRate'}      onClick={() => setSort('convRate')} />
                <SortableTh label="ROAS"          active={sort === 'roas'}          onClick={() => setSort('roas')} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.adId}>
                  <td style={cell}>
                    <div style={{ fontWeight: 500 }}>{r.adName ?? '(unnamed ad)'}</div>
                    <div style={{ fontSize: 11, color: 'var(--sos-text-tertiary, #6b7280)' }}>
                      {r.campaignName ?? r.campaignId}
                    </div>
                  </td>
                  <td style={cell}><StatusPill status={r.effectiveStatus} /></td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmtInt(r.conversations)}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmtInt(r.clientsConverted)}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{fmtPct(r.conversionRate)}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }}>{fmtRoasPct(r.roas)}</td>
                </tr>
              ))}
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)' }}>
                    {rows.length === 0
                      ? 'No ad activity in this window.'
                      : `No ads match "${q}".`}
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

/** ROAS shown as a percentage — 3.24x returns "324%". Never leaks the
 *  underlying spend or revenue. */
function fmtRoasPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.round(v * 100)}%`;
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

function SortableTh({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <th style={{ ...cellHead, textAlign: 'right', cursor: 'pointer' }} onClick={onClick}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: active ? 'var(--sos-brand-primary-strong, #2563eb)' : undefined }}>
        {label} {active ? '↓' : ''}
      </span>
    </th>
  );
}
