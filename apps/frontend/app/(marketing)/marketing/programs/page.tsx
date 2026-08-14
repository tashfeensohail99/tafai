'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { GlassCard, PageHeader } from '@/components/sales-v2/ui';
import { WindowPicker } from '@/components/marketing/WindowPicker';
import {
  fmtInt,
  fmtPct,
  getMarketingLeadsByProgram,
  type MarketingProgramRow,
} from '@/lib/marketing';

const PROGRAM_COLOR: Record<string, string> = {
  C11: '#2563eb',
  JR: '#7c3aed',
  VISIT_VISA: '#0891b2',
  C10: '#0d9488',
  RCIP: '#d97706',
  OTHER: '#6b7280',
};

export default function MarketingProgramsPage() {
  const [days, setDays] = useState(30);
  const [programs, setPrograms] = useState<MarketingProgramRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMarketingLeadsByProgram(days)
      .then((res) => {
        if (!cancelled) {
          setPrograms(res.programs);
          setTotal(res.totalResponses);
        }
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
        title="Responses by program"
        description={`Ad responses split by program (C11 / JR / Visit Visa) over the last ${days} days. Each response is bucketed from the ad's own name.`}
      />

      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--sos-brand-primary-strong, #2563eb)', flexShrink: 0 }}>
            <Info size={17} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)', lineHeight: 1.55 }}>
            <strong style={{ color: 'var(--sos-text-primary, #111827)' }}>How this is grouped.</strong>{' '}
            Each ad response is bucketed by the program named in the ad/campaign (e.g. &ldquo;…c11…&rdquo;, &ldquo;…JR…&rdquo;,
            &ldquo;…Visit visa…&rdquo;). Ads with no program in their name fall into{' '}
            <strong>Other / uncategorized</strong> — shown openly, never hidden.
          </div>
        </div>
      </GlassCard>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, color: 'var(--sos-text-secondary, #4b5563)' }}>
          {loading ? 'Loading…' : (
            <>
              <strong>{fmtInt(total)}</strong> total ad responses
            </>
          )}
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

      {!loading && !error ? (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {programs.map((p) => {
            const color = PROGRAM_COLOR[p.program] ?? '#6b7280';
            return (
              <GlassCard key={p.program} variant="default">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--sos-text-primary, #111827)' }}>{p.label}</span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--sos-text-tertiary, #6b7280)', flexShrink: 0 }}>{fmtPct(p.share)}</span>
                  </div>

                  <div>
                    <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--sos-text-primary, #111827)', lineHeight: 1 }}>
                      {fmtInt(p.responses)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--sos-text-tertiary, #6b7280)', marginTop: 2 }}>responses</div>
                  </div>

                  <div style={{ height: 6, borderRadius: 4, background: 'var(--sos-border-subtle, rgba(0,0,0,0.08))', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round((p.share ?? 0) * 100)}%`, background: color }} />
                  </div>

                  <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--sos-text-secondary, #4b5563)' }}>
                    <span><strong>{fmtInt(p.converted)}</strong> clients</span>
                    <span><strong>{fmtPct(p.conversionRate)}</strong> conv.</span>
                  </div>

                  {p.topAds.length > 0 ? (
                    <div style={{ borderTop: '1px solid var(--sos-border-subtle, rgba(0,0,0,0.06))', paddingTop: 8 }}>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--sos-text-tertiary, #6b7280)', marginBottom: 6 }}>
                        Top ads
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {p.topAds.map((a) => (
                          <div key={a.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                            <span style={{ color: 'var(--sos-text-secondary, #4b5563)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {a.name}
                            </span>
                            <span style={{ color: 'var(--sos-text-tertiary, #6b7280)', flexShrink: 0 }}>{fmtInt(a.responses)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </GlassCard>
            );
          })}
          {programs.length === 0 ? (
            <GlassCard variant="default">
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--sos-text-tertiary, #6b7280)' }}>
                No ad responses in this window.
              </div>
            </GlassCard>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
