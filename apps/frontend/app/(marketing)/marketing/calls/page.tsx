'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Info, PhoneIncoming } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import { RangePicker } from '@/components/marketing/RangePicker';
import {
  describeRange,
  fetchMetaAdCalls,
  fmtInt,
  rangeParams,
  type MarketingCallsByRepResponse,
  type MarketingRange,
} from '@/lib/marketing';

/**
 * Meta-Ad Calls — Telenor inbound calls that came from Meta/Facebook-ad-sourced
 * leads, per rep + total, for the selected window. Counts only. "Routed" is the
 * subset our system delivered to a rep's line; Telenor doesn't report
 * answered/missed, so this is "calls delivered to the rep", not "answered".
 */
export default function MarketingCallsPage() {
  const [range, setRange] = useState<MarketingRange>({ mode: 'days', days: 30 });
  const [data, setData] = useState<MarketingCallsByRepResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMetaAdCalls(rangeParams(range))
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
  }, [range]);

  const byRep = data?.byRep ?? [];
  const reasons = data?.notRoutedReasons ?? [];
  const maxCalls = Math.max(1, ...byRep.map((r) => r.calls));

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
        title="Meta-ad calls"
        description={`Telenor inbound calls from Meta-ad customers (${describeRange(range)}), per rep and in total.`}
      />

      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--sos-brand-primary-strong, #2563eb)', flexShrink: 0 }}>
            <Info size={17} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', lineHeight: 1.55 }}>
            <strong style={{ color: 'var(--sos-text-primary, #111827)' }}>What this counts.</strong>{' '}
            Counts calls our system <strong>routed</strong> to each rep&apos;s line from Meta-ad customers.
            Telenor doesn&apos;t report answered/missed, so this is &ldquo;calls delivered to the rep&rdquo;,
            not &ldquo;answered&rdquo;.
          </div>
        </div>
      </GlassCard>

      {/* summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Stat label="Total ad-calls" value={loading ? '…' : fmtInt(data?.total)} tone="#2563eb" />
        <Stat label="Routed to a rep" value={loading ? '…' : fmtInt(data?.routed)} tone="#059669" />
        <Stat
          label="Not routed"
          value={loading ? '…' : fmtInt(data?.notRouted)}
          tone={(data?.notRouted ?? 0) > 0 ? '#d97706' : '#6b7280'}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <RangePicker value={range} onChange={setRange} />
      </div>

      {error ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#b91c1c' }}>
            <AlertTriangle size={18} />
            <span>Couldn&apos;t load: {error}</span>
          </div>
        </GlassCard>
      ) : null}

      {/* per-rep table */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--sos-text-primary, #111827)' }}>
          <PhoneIncoming size={15} />
          <strong style={{ fontSize: 13 }}>Calls by rep</strong>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={th}>#</th>
                <th style={th}>Rep</th>
                <th style={{ ...th, textAlign: 'right' }}>Calls</th>
                <th style={{ ...th, textAlign: 'right' }}>Routed</th>
                <th style={{ ...th, width: '28%' }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {byRep.map((r, i) => (
                <tr key={r.employeeId ?? `row-${i}`}>
                  <td style={{ ...cell, color: 'var(--sos-text-tertiary, #6b7280)' }}>{i + 1}</td>
                  <td style={cell}>
                    <span style={{ fontWeight: 500 }}>{r.name}</span>
                  </td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }}>{fmtInt(r.calls)}</td>
                  <td style={{ ...cell, textAlign: 'right', color: '#059669' }}>{fmtInt(r.routed)}</td>
                  <td style={cell}>
                    <div style={{ height: 6, borderRadius: 4, background: 'var(--sos-border-subtle, rgba(0,0,0,0.08))', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.round((r.calls / maxCalls) * 100)}%`, background: '#2563eb' }} />
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && byRep.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...cell, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)', padding: 20 }}>
                    No Meta-ad calls in this window.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* why not routed */}
      {reasons.length > 0 ? (
        <GlassCard variant="default">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--sos-text-primary, #111827)' }}>
            <AlertTriangle size={15} />
            <strong style={{ fontSize: 13 }}>Why not routed</strong>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={th}>Reason</th>
                  <th style={{ ...th, textAlign: 'right' }}>Calls</th>
                </tr>
              </thead>
              <tbody>
                {reasons.map((r) => (
                  <tr key={r.reason}>
                    <td style={cell}>{r.reason}</td>
                    <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }}>{fmtInt(r.calls)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      ) : null}
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
