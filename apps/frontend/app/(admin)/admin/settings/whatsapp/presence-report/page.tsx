'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock, MinusCircle } from 'lucide-react';
import {
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
} from '@/components/sales-v2/ui';
import { fetchPresenceDailyReport, type PresenceDailyReport } from '@/lib/whatsapp-admin';

/**
 * Admin daily presence-accountability report. Today's live Away/Offline
 * working-hours minutes + SLA penalty per agent, plus end-of-day history.
 * The same summary is emailed to admin@tashfeengroup.com at 6 PM.
 */
function fmt(mins: number): string {
  if (!mins) return '—';
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

const TONE: Record<string, 'success' | 'warning' | 'neutral'> = {
  ONLINE: 'success',
  AWAY: 'warning',
  OFFLINE: 'neutral',
};

export default function PresenceReportPage() {
  const [data, setData] = useState<PresenceDailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await fetchPresenceDailyReport());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, [reload]);

  const today = data?.today;
  const onlineNow = today?.rows.filter((r) => r.presence === 'ONLINE').length ?? 0;
  const awayNow = today?.rows.filter((r) => r.presence === 'AWAY').length ?? 0;
  const offlineNow = today?.rows.filter((r) => r.presence === 'OFFLINE').length ?? 0;
  const penalizedToday = today?.rows.filter((r) => r.penalizedToday).length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="WhatsApp · Accountability"
        title="Daily presence report"
        description="Manual Away / Offline time during working hours (9–6, Mon–Fri), and SLA penalties. Live for today; history below. Emailed to admin@tashfeengroup.com at 6 PM."
      />

      <section style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <MetricCard label="Online now" value={onlineNow} tone="success" Icon={CheckCircle2} hint="Currently available" />
        <MetricCard label="Away now" value={awayNow} tone="warning" Icon={MinusCircle} hint="Marked Away" />
        <MetricCard label="Offline now" value={offlineNow} tone="neutral" Icon={Clock} hint="Not receiving leads" />
        <MetricCard label="Penalized today" value={penalizedToday} tone={penalizedToday > 0 ? 'danger' : 'neutral'} Icon={AlertTriangle} hint="Offline > 2h (−2 SLA)" />
      </section>

      {/* Today (live) */}
      <GlassCard variant="default" padded={false}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-lg)', margin: 0 }}>
            Today {today?.date ? `· ${today.date}` : ''} <span className="sos-text-faint" style={{ fontSize: 12 }}>(live)</span>
          </h2>
        </div>
        {loading && !data ? (
          <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center' }}>Loading…</div>
        ) : error ? (
          <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error}</div>
        ) : (today?.rows.length ?? 0) === 0 ? (
          <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center' }}>No agents in the inbox pool.</div>
        ) : (
          <ReportTable
            cols={['Agent', 'Presence', 'Away (today)', 'Offline (today)', 'SLA penalty']}
            rows={(today?.rows ?? []).map((r) => [
              r.name,
              <StatusBadge key="p" tone={TONE[r.presence] ?? 'neutral'} size="sm" dot>{r.presence.toLowerCase()}</StatusBadge>,
              fmt(r.awayMinutes),
              <span key="o" style={{ color: r.offlineMinutes >= 120 ? 'var(--sos-status-danger)' : undefined }}>{fmt(r.offlineMinutes)}</span>,
              r.penaltyPoints > 0 ? <span key="pen" style={{ color: 'var(--sos-status-danger)', fontWeight: 600 }}>−{r.penaltyPoints}</span> : '—',
            ])}
          />
        )}
      </GlassCard>

      {/* History */}
      {(data?.history.length ?? 0) > 0 &&
        data!.history.map((day) => (
          <GlassCard key={day.date} variant="default" padded={false}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
              <h3 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>{day.date}</h3>
            </div>
            <ReportTable
              cols={['Agent', 'Away', 'Offline', 'SLA penalty']}
              rows={day.rows
                .filter((r) => r.awayMinutes > 0 || r.offlineMinutes > 0 || r.penaltyApplied > 0)
                .map((r) => [
                  r.name,
                  fmt(r.awayMinutes),
                  <span key="o" style={{ color: r.offlineMinutes >= 120 ? 'var(--sos-status-danger)' : undefined }}>{fmt(r.offlineMinutes)}</span>,
                  r.penaltyApplied > 0 ? <span key="pen" style={{ color: 'var(--sos-status-danger)', fontWeight: 600 }}>−{r.penaltyApplied}</span> : '—',
                ])}
              emptyNote="Everyone stayed Online."
            />
          </GlassCard>
        ))}
    </div>
  );
}

function ReportTable({
  cols,
  rows,
  emptyNote,
}: {
  cols: string[];
  rows: ReactNode[][];
  emptyNote?: string;
}) {
  if (rows.length === 0) {
    return <div className="sos-text-muted" style={{ padding: 18, textAlign: 'center', fontSize: 13 }}>{emptyNote ?? 'No data.'}</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                style={{
                  textAlign: 'left',
                  padding: '10px 18px',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: 'var(--sos-text-faint)',
                  borderBottom: '1px solid var(--sos-border-subtle)',
                  whiteSpace: 'nowrap',
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--sos-border-subtle)' }}>
              {cells.map((cell, j) => (
                <td key={j} style={{ padding: '12px 18px', fontSize: 13.5, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
