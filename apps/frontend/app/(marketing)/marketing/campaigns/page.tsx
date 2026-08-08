'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import { StatusPill } from '@/components/marketing/StatusPill';
import { WindowPicker } from '@/components/marketing/WindowPicker';
import { fmtCad, fmtInt, fmtRoas, getMarketingCampaigns, type MarketingCampaign } from '@/lib/marketing';

export default function MarketingCampaignsPage() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<MarketingCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [includeIdle, setIncludeIdle] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMarketingCampaigns({ days, includeIdle })
      .then((res) => {
        if (!cancelled) setRows(res.campaigns);
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
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.name, r.campaignId, r.objective]
        .filter((v): v is string => typeof v === 'string')
        .some((v) => v.toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Campaigns"
        description={`The Campaign → Ad Set → Ad hierarchy, synced from Meta every 6h. Roll-up spend, leads and revenue attributed to each campaign over the last ${days} days.`}
      />

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
            placeholder="Search campaigns…"
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
            <span>Couldn't load campaigns: {error}</span>
          </div>
        </GlassCard>
      ) : null}

      <GlassCard variant="default">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--sos-text-secondary, #4b5563)' }}>
            {loading ? 'Loading…' : `${filtered.length} campaign${filtered.length === 1 ? '' : 's'}${includeIdle ? ' (incl. idle)' : ''}`}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--sos-text-tertiary, #6b7280)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={cellHead}></th>
                <th style={cellHead}>Campaign</th>
                <th style={cellHead}>Status</th>
                <th style={{ ...cellHead, textAlign: 'right' }}>Spend</th>
                <th style={{ ...cellHead, textAlign: 'right' }}>Leads</th>
                <th style={{ ...cellHead, textAlign: 'right' }}>Clients</th>
                <th style={{ ...cellHead, textAlign: 'right' }}>CPL</th>
                <th style={{ ...cellHead, textAlign: 'right' }}>CPA</th>
                <th style={{ ...cellHead, textAlign: 'right' }}>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const isOpen = expanded.has(c.campaignId);
                const canExpand = c.adsets.length > 0;
                return (
                  <FragmentRow
                    key={c.campaignId}
                    campaign={c}
                    isOpen={isOpen}
                    canExpand={canExpand}
                    onToggle={() => canExpand && toggle(c.campaignId)}
                  />
                );
              })}
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 30, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)' }}>
                    {rows.length === 0 ? 'No campaign activity in this window.' : `No campaigns match "${q}".`}
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

function FragmentRow({
  campaign,
  isOpen,
  canExpand,
  onToggle,
}: {
  campaign: MarketingCampaign;
  isOpen: boolean;
  canExpand: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <td style={{ ...cell, width: 32, cursor: canExpand ? 'pointer' : 'default', color: 'var(--sos-text-tertiary, #6b7280)' }} onClick={onToggle}>
          {canExpand ? isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
        </td>
        <td style={cell}>
          <div style={{ fontWeight: 500 }}>{campaign.name ?? '(unnamed campaign)'}</div>
          <div style={{ fontSize: 11, color: 'var(--sos-text-tertiary, #6b7280)' }}>
            {campaign.objective ?? '—'} · {campaign.campaignId}
          </div>
        </td>
        <td style={cell}><StatusPill status={campaign.effectiveStatus} /></td>
        <td style={{ ...cell, textAlign: 'right' }}>{fmtCad(campaign.spendBaseCad, { compact: true })}</td>
        <td style={{ ...cell, textAlign: 'right' }}>{fmtInt(campaign.leads)}</td>
        <td style={{ ...cell, textAlign: 'right' }}>{fmtInt(campaign.clientsConverted)}</td>
        <td style={{ ...cell, textAlign: 'right' }}>{fmtCad(campaign.cpl)}</td>
        <td style={{ ...cell, textAlign: 'right' }}>{fmtCad(campaign.cpa)}</td>
        <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }}>{fmtRoas(campaign.roas)}</td>
      </tr>
      {isOpen
        ? campaign.adsets.map((s) => (
            <tr key={s.adsetId} style={{ background: 'var(--sos-surface-subtle, rgba(0,0,0,0.02))' }}>
              <td style={cell}></td>
              <td style={{ ...cell, paddingLeft: 28 }}>
                <div style={{ fontSize: 12 }}>↳ {s.name ?? '(unnamed ad set)'}</div>
                <div style={{ fontSize: 10, color: 'var(--sos-text-tertiary, #6b7280)' }}>{s.adsetId}</div>
              </td>
              <td style={cell}><StatusPill status={s.effectiveStatus} /></td>
              <td style={{ ...cell, textAlign: 'right' }}>{fmtCad(s.spendBaseCad, { compact: true })}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{fmtInt(s.leads)}</td>
              <td style={cell}></td>
              <td style={{ ...cell, textAlign: 'right' }}>{fmtCad(s.cpl)}</td>
              <td style={cell}></td>
              <td style={cell}></td>
            </tr>
          ))
        : null}
    </>
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
