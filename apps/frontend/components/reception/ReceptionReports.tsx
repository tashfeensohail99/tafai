'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Loader2,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { GlassCard, MetricCard, PageHeader } from '@/components/sales-v2/ui';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useReceptionSession } from '@/components/layout/ReceptionShell';
import { getReceptionReport, type ReceptionReport } from '@/lib/reception-api';
import { STATUS_LABEL, STATUS_TONE, TYPE_META, td, th, todayPkt } from './shared';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** N days before today (PKT), as YYYY-MM-DD. */
function daysAgo(n: number): string {
  const base = new Date(`${todayPkt()}T00:00:00Z`).getTime();
  return new Date(base - n * 86400000).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → "4 Jul" for the trend axis. */
function shortDay(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Map a MetricTone-ish name to a solid CSS colour var that actually exists. */
function toneColor(tone: string): string {
  if (tone === 'accent') return 'var(--sos-brand-primary-strong)';
  if (tone === 'warm') return 'var(--sos-brand-accent)';
  if (tone === 'neutral') return 'var(--sos-text-secondary)';
  return `var(--sos-status-${tone})`;
}

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString()}`;
}

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export function ReceptionReports() {
  const { user } = useReceptionSession();
  const canView =
    user.permissions.includes('reception.view') || user.permissions.includes('reception.check_in');

  const [from, setFrom] = useState<string>(() => daysAgo(29));
  const [to, setTo] = useState<string>(() => todayPkt());
  const [report, setReport] = useState<ReceptionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback((f: string, t: string) => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    getReceptionReport({ from: f, to: t })
      .then((r) => {
        if (mine === seq.current) setReport(r);
      })
      .catch((e) => {
        if (mine === seq.current) setError(e instanceof Error ? e.message : 'Could not load the report');
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (canView) load(from, to);
  }, [canView, from, to, load]);

  if (!canView) {
    return <PermissionDeniedState message="You need reception access to view reports." />;
  }

  const applyPreset = (days: number) => {
    setFrom(daysAgo(days - 1));
    setTo(todayPkt());
  };

  const maxDaily = report ? Math.max(1, ...report.footfall.daily.map((d) => d.total)) : 1;
  // Backend returns `collected` sorted by amount desc. Show one currency's total
  // when there's only one; a currency count (with the breakdown card below) when
  // fees span more than one, so the headline is never a misleading partial sum.
  const collected = report?.consult.collected ?? [];
  const consultValue =
    collected.length === 0 ? '—' : collected.length === 1 ? money(collected[0].currency, collected[0].amount) : `${collected.length} currencies`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Reception · Insights"
        title="Reports"
        description="Footfall, walk-in→client conversion, consultation revenue and no-shows over a chosen window."
      />

      {/* Date range controls */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="sos-text-faint" style={{ fontSize: 11, fontWeight: 600 }}>From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="sos-input"
              style={{ width: 'auto' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="sos-text-faint" style={{ fontSize: 11, fontWeight: 600 }}>To</span>
            <input
              type="date"
              value={to}
              min={from}
              max={todayPkt()}
              onChange={(e) => setTo(e.target.value)}
              className="sos-input"
              style={{ width: 'auto' }}
            />
          </label>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.days)}
                className="sos-btn sos-btn--ghost sos-btn--sm"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>

      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      ) : null}

      {loading && !report ? (
        <div className="sos-text-muted" style={{ padding: 40, textAlign: 'center' }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading report…
        </div>
      ) : report ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
          {/* Headline KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <MetricCard
              label="Footfall"
              value={report.footfall.total.toLocaleString()}
              hint={`${report.range.days} day${report.range.days === 1 ? '' : 's'}`}
              tone="info"
              Icon={Users}
            />
            <MetricCard
              label="Walk-in → client"
              value={pct(report.conversion.conversionRate)}
              hint={`${report.conversion.converted} of ${report.conversion.leads} walk-in leads`}
              tone="success"
              Icon={UserCheck}
            />
            <MetricCard
              label="Consult revenue"
              value={consultValue}
              hint={`${report.consult.count} paid consult${report.consult.count === 1 ? '' : 's'}`}
              tone="warning"
              Icon={Wallet}
            />
            <MetricCard
              label="No-show rate"
              value={pct(report.outcomes.noShowRate)}
              hint={`${report.outcomes.noShow} missed`}
              tone="danger"
              Icon={CalendarClock}
            />
          </div>

          {/* Footfall by type + daily trend */}
          <GlassCard variant="default" padded="lg">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <BarChart3 size={16} style={{ color: 'var(--sos-brand-accent)' }} />
              <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>Footfall</h2>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 18 }}>
              {([
                ['WALK_IN', report.footfall.walkIn],
                ['EXISTING_CLIENT', report.footfall.existingClient],
                ['PAID_CONSULT', report.footfall.paidConsult],
              ] as const).map(([type, count]) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    aria-hidden
                    style={{ width: 10, height: 10, borderRadius: 3, background: toneColor(TYPE_META[type].tone) }}
                  />
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{count.toLocaleString()}</span>
                  <span className="sos-text-faint" style={{ fontSize: 12.5 }}>{TYPE_META[type].label}</span>
                </div>
              ))}
            </div>

            {/* Daily trend bars */}
            {report.footfall.total === 0 ? (
              <div className="sos-text-faint" style={{ fontSize: 12.5, padding: '8px 0' }}>No visits in this range.</div>
            ) : (
              <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120, minWidth: '100%' }}>
                  {report.footfall.daily.map((d) => (
                    <div
                      key={d.date}
                      title={`${shortDay(d.date)} — ${d.total} visit${d.total === 1 ? '' : 's'}`}
                      style={{ flex: '1 0 8px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}
                    >
                      <div
                        style={{
                          height: `${(d.total / maxDaily) * 100}%`,
                          minHeight: d.total > 0 ? 3 : 0,
                          borderRadius: '3px 3px 0 0',
                          background: 'var(--sos-brand-primary-strong)',
                          transition: 'height .2s',
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                  <span className="sos-text-faint" style={{ fontSize: 11 }}>{shortDay(report.range.from)}</span>
                  <span className="sos-text-faint" style={{ fontSize: 11 }}>{shortDay(report.range.to)}</span>
                </div>
              </div>
            )}
          </GlassCard>

          {/* Visit outcomes */}
          <div>
            <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: '0 0 10px' }}>Visit outcomes</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              {(['DONE', 'WAITING', 'IN_MEETING', 'NO_SHOW', 'CANCELLED'] as const).map((s) => {
                const value = {
                  DONE: report.outcomes.done,
                  WAITING: report.outcomes.waiting,
                  IN_MEETING: report.outcomes.inMeeting,
                  NO_SHOW: report.outcomes.noShow,
                  CANCELLED: report.outcomes.cancelled,
                }[s];
                return <MetricCard key={s} label={STATUS_LABEL[s]} value={value.toLocaleString()} tone={STATUS_TONE[s]} />;
              })}
            </div>
          </div>

          {/* Conversion funnel + consult revenue */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
            <GlassCard variant="default" padded="lg">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <UserCheck size={16} style={{ color: 'var(--sos-status-success)' }} />
                <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>Walk-in conversion</h2>
              </div>
              <FunnelRow label="Walk-in visits" value={report.conversion.walkIns} tone="info" />
              <FunnelRow label="Distinct leads" value={report.conversion.leads} tone="accent" />
              <FunnelRow label="Became clients" value={report.conversion.converted} tone="success" last />
              <div className="sos-text-faint" style={{ fontSize: 12, marginTop: 10 }}>
                {pct(report.conversion.conversionRate)} of the walk-in leads logged in this window have since signed up.
              </div>
            </GlassCard>

            <GlassCard variant="default" padded="lg">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Wallet size={16} style={{ color: 'var(--sos-status-warning)' }} />
                <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>Paid consultations</h2>
              </div>
              {report.consult.count === 0 ? (
                <div className="sos-text-faint" style={{ fontSize: 12.5 }}>No paid consultations in this range.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {report.consult.collected.map((c) => (
                      <div key={c.currency} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span className="sos-text-secondary" style={{ fontSize: 13 }}>Fees ({c.currency})</span>
                        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{money(c.currency, c.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 18, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--sos-border-subtle)' }}>
                    <div>
                      <div className="sos-text-faint" style={{ fontSize: 11 }}>Consults</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{report.consult.count}</div>
                    </div>
                    <div>
                      <div className="sos-text-faint" style={{ fontSize: 11 }}>Paid but no-show</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: report.consult.noShow > 0 ? 'var(--sos-status-danger)' : 'var(--sos-text-primary)' }}>{report.consult.noShow}</div>
                    </div>
                  </div>
                  <div className="sos-text-faint" style={{ fontSize: 11.5, marginTop: 10 }}>Fees are creditable against a future service fee · counted by each visit&rsquo;s check-in date.</div>
                </>
              )}
            </GlassCard>
          </div>

          {/* By host */}
          <GlassCard variant="default" padded="lg">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Users size={16} style={{ color: 'var(--sos-brand-accent)' }} />
              <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>By host</h2>
            </div>
            {report.hosts.length === 0 ? (
              <div className="sos-text-faint" style={{ fontSize: 12.5 }}>No visits were assigned to a host in this range.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Host</th>
                      <th style={{ ...th, textAlign: 'right' }}>Visits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.hosts.map((h) => (
                      <tr key={h.id}>
                        <td style={td}>{h.name}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{h.visits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </div>
      ) : null}
    </div>
  );
}

function FunnelRow({
  label,
  value,
  tone,
  last,
}: {
  label: string;
  value: number;
  tone: 'info' | 'accent' | 'success';
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '9px 0',
        borderBottom: last ? 'none' : '1px solid var(--sos-border-subtle)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: toneColor(tone) }} />
        <span className="sos-text-secondary" style={{ fontSize: 13 }}>{label}</span>
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{value.toLocaleString()}</span>
    </div>
  );
}
