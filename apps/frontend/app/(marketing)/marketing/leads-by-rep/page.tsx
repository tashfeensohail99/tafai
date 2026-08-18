'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Search } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import { WindowPicker } from '@/components/marketing/WindowPicker';
import { fmtInt, fmtPct, getMarketingLeadsByRep, type MarketingLeadsByRepResponse } from '@/lib/marketing';

/**
 * Leads received per rep — the per-employee lead-volume monitor the marketing
 * team asked for. Counts only (total + how many came from our Meta ads); no
 * revenue, no client/agreement data. Server enforces the same via marketing.view.
 */
export default function MarketingLeadsByRepPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<MarketingLeadsByRepResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMarketingLeadsByRep(days)
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

  const reps = useMemo(() => {
    const all = data?.reps ?? [];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((r) => r.name.toLowerCase().includes(needle)) : all;
  }, [data, q]);

  const maxTotal = useMemo(() => Math.max(1, ...(data?.reps ?? []).map((r) => r.total)), [data]);

  const cell: React.CSSProperties = {
    padding: '10px 8px',
    borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.05))',
  };
  const th: React.CSSProperties = {
    padding: '8px',
    borderBottom: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.08))',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--sos-text-tertiary, #6b7280)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Leads by rep"
        description={`How many leads each rep received in the last ${days} days, and how many came from our Meta ads.`}
      />

      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--sos-brand-primary-strong, #2563eb)', flexShrink: 0 }}>
            <Info size={17} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', lineHeight: 1.55 }}>
            <strong style={{ color: 'var(--sos-text-primary, #111827)' }}>What this counts.</strong>{' '}
            Every lead <em>received</em> (assigned to a rep) in the window, by the date it came in.{' '}
            <strong>From ads</strong> is the subset attributed to a Meta ad; <strong>Other</strong> is everything
            else — WhatsApp walk-ins, UAN calls, imports. Counts only, no revenue.
          </div>
        </div>
      </GlassCard>

      {/* summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Stat label="Leads received" value={loading ? '…' : fmtInt(data?.totals.total)} tone="#2563eb" />
        <Stat label="From our ads" value={loading ? '…' : fmtInt(data?.totals.fromAds)} tone="#7c3aed" />
        <Stat label="Other sources" value={loading ? '…' : fmtInt(data?.totals.other)} tone="#0891b2" />
        <Stat label="Unassigned" value={loading ? '…' : fmtInt(data?.unassigned)} tone={(data?.unassigned ?? 0) > 0 ? '#d97706' : '#6b7280'} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ position: 'relative', minWidth: 220 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--sos-text-tertiary, #6b7280)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search rep…"
            style={{
              padding: '8px 10px 8px 30px',
              borderRadius: 10,
              border: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.12))',
              background: 'var(--sos-surface, #fff)',
              color: 'var(--sos-text-primary, #111827)',
              fontSize: 13,
              width: '100%',
            }}
          />
        </div>
        <WindowPicker value={days} onChange={setDays} />
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
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={th}>#</th>
                <th style={th}>Rep</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
                <th style={{ ...th, textAlign: 'right' }}>From ads</th>
                <th style={{ ...th, textAlign: 'right' }}>Other</th>
                <th style={{ ...th, width: '28%' }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((r, i) => (
                <tr key={r.employeeId}>
                  <td style={{ ...cell, color: 'var(--sos-text-tertiary, #6b7280)' }}>{i + 1}</td>
                  <td style={cell}>
                    <span style={{ fontWeight: 500 }}>{r.name}</span>
                    {!r.isActive ? (
                      <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'var(--sos-border-subtle, rgba(0,0,0,0.08))', color: 'var(--sos-text-tertiary, #6b7280)' }}>
                        inactive
                      </span>
                    ) : null}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }}>{fmtInt(r.total)}</td>
                  <td style={{ ...cell, textAlign: 'right', color: '#7c3aed' }}>{fmtInt(r.fromAds)}</td>
                  <td style={{ ...cell, textAlign: 'right', color: 'var(--sos-text-secondary, #4b5563)' }}>{fmtInt(r.other)}</td>
                  <td style={cell}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 4, background: 'var(--sos-border-subtle, rgba(0,0,0,0.08))', overflow: 'hidden', display: 'flex' }}>
                        <div style={{ height: '100%', width: `${Math.round((r.fromAds / maxTotal) * 100)}%`, background: '#7c3aed' }} />
                        <div style={{ height: '100%', width: `${Math.round((r.other / maxTotal) * 100)}%`, background: '#2563eb' }} />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && reps.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...cell, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)', padding: 20 }}>
                    {q ? 'No rep matches your search.' : 'No leads received in this window.'}
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

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <GlassCard variant="default">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--sos-text-tertiary, #6b7280)' }}>{label}</span>
        <span style={{ fontSize: 24, fontWeight: 700, color: tone, lineHeight: 1 }}>{value}</span>
      </div>
    </GlassCard>
  );
}
