'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  Clock,
  Loader2,
  MessageSquare,
  RefreshCw,
  Reply,
  UserPlus,
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
import { fetchWhatsAppReport, type ReportPeriod, type WhatsAppReport } from '@/lib/wa-report';

const TABS: Array<{ key: ReportPeriod; label: string }> = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

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
const num: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

function pctColor(p: number): string {
  if (p >= 75) return 'var(--sos-success, #15803d)';
  if (p >= 60) return 'var(--sos-warn, #b45309)';
  return 'var(--sos-danger, #b91c1c)';
}

/** ISO → "HH:MM PKT" (UTC+5). */
function pktTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function fmtRange(report: WhatsAppReport): string {
  const f = new Date(report.from);
  const t = new Date(report.to);
  const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' };
  const ff = new Intl.DateTimeFormat('en-GB', opt).format(f);
  const tt = new Intl.DateTimeFormat('en-GB', { ...opt, hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
  return `${ff} → ${tt} PKT`;
}

export default function WhatsAppReportPage() {
  const { user } = useAdminSession();
  const canView = user.permissions.includes('leads.view_all') || user.permissions.includes('settings.manage');

  const [period, setPeriod] = useState<ReportPeriod>('daily');
  const [report, setReport] = useState<WhatsAppReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchWhatsAppReport(period));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load WhatsApp report');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    if (canView) void reload();
  }, [canView, reload]);

  if (!canView) {
    return <PermissionDeniedState message="You need the leads.view_all or reports.view permission to view the WhatsApp report." />;
  }

  const t = report?.totals;
  const kpis: Array<{ label: string; value: string; hint: string; tone: MetricTone; Icon: typeof Users }> = [
    { label: 'People messaged', value: t ? `${t.texted}` : '—', hint: 'Distinct contacts who texted in this period', tone: 'info', Icon: MessageSquare },
    { label: 'Replied', value: t ? `${t.replied} · ${t.replyPct}%` : '—', hint: 'Got a human reply (bot excluded)', tone: t && t.replyPct >= 75 ? 'success' : 'warning', Icon: Reply },
    { label: 'New contacts', value: t ? `${t.newReplied}/${t.newContacts}` : '—', hint: 'First-time texters → how many replied', tone: 'accent', Icon: UserPlus },
    { label: 'Returning', value: t ? `${t.oldContacts}` : '—', hint: 'Existing contacts who messaged again', tone: 'neutral', Icon: Users },
    { label: 'Awaiting reply', value: t ? `${t.awaiting}` : '—', hint: 'Messaged but no human reply yet', tone: t && t.awaiting > 0 ? 'danger' : 'success', Icon: Clock },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="CRM · WhatsApp"
        title="WhatsApp Report"
        description="Who messaged the team and how many got a human reply. Human replies only — the assistant bot is excluded so this reflects what the sales team actually did. All times in Pakistan time."
        actions={
          <GhostButton iconLeft={<RefreshCw size={14} />} onClick={() => void reload()}>
            Refresh
          </GhostButton>
        }
      />

      {/* Period tabs */}
      <GlassCard variant="soft" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setPeriod(tab.key)}
                className={period === tab.key ? 'sos-chip sos-chip--active' : 'sos-chip'}
                style={{
                  cursor: 'pointer',
                  padding: '6px 16px',
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: '1px solid var(--sos-border-subtle)',
                  background: period === tab.key ? 'var(--sos-brand-primary)' : 'var(--sos-surface-1)',
                  color: period === tab.key ? '#fff' : 'var(--sos-text-secondary)',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="sos-text-faint" style={{ fontSize: 12, marginLeft: 'auto' }}>
            {report ? `${report.label} · ${fmtRange(report)}` : ''}
          </span>
        </div>
      </GlassCard>

      {error ? <div className="sos-banner sos-banner--danger">{error}</div> : null}

      {/* Headline KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        {kpis.map((k) => (
          <MetricCard key={k.label} label={k.label} value={k.value} hint={k.hint} tone={k.tone} Icon={k.Icon} />
        ))}
      </div>

      {/* Per-rep table */}
      <GlassCard variant="default" padded={false} glow="accent">
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Users size={16} style={{ color: 'var(--sos-brand-accent)' }} />
          <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>By salesperson</h2>
          <span className="sos-text-faint" style={{ fontSize: 12 }}>Sorted by who has the most contacts still awaiting a reply.</span>
          {report ? (
            <span style={{ marginLeft: 'auto' }}>
              <StatusBadge tone="neutral" size="sm" dot={false}>{report.reps.length} reps</StatusBadge>
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="sos-text-muted" style={{ padding: 22, textAlign: 'center' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading…
          </div>
        ) : !report || report.reps.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 22, textAlign: 'center', fontSize: 13 }}>No WhatsApp activity in this period.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={th}>Rep</th>
                  <th style={{ ...th, textAlign: 'right' }}>Texted</th>
                  <th style={{ ...th, textAlign: 'right' }}>Replied</th>
                  <th style={{ ...th, textAlign: 'right' }}>Reply %</th>
                  <th style={{ ...th, textAlign: 'right' }}>New</th>
                  <th style={{ ...th, textAlign: 'right' }}>Returning</th>
                  <th style={{ ...th, textAlign: 'right' }}>Awaiting</th>
                </tr>
              </thead>
              <tbody>
                {report.reps.map((r) => (
                  <tr key={r.employeeId ?? 'unassigned'}>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{r.name}</td>
                    <td style={num}>{r.texted}</td>
                    <td style={num}>{r.replied}</td>
                    <td style={{ ...num, fontWeight: 700, color: pctColor(r.replyPct) }}>{r.replyPct}%</td>
                    <td style={num}>{r.newReplied}/{r.newContacts}</td>
                    <td style={num}>{r.oldReplied}/{r.oldContacts}</td>
                    <td style={{ ...num, fontWeight: 700, color: r.awaiting > 0 ? 'var(--sos-danger, #b91c1c)' : 'var(--sos-text-faint)' }}>{r.awaiting}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...td, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Total</td>
                  <td style={{ ...num, fontWeight: 700 }}>{t?.texted}</td>
                  <td style={{ ...num, fontWeight: 700 }}>{t?.replied}</td>
                  <td style={{ ...num, fontWeight: 700, color: t ? pctColor(t.replyPct) : undefined }}>{t?.replyPct}%</td>
                  <td style={{ ...num, fontWeight: 700 }}>{t?.newReplied}/{t?.newContacts}</td>
                  <td style={{ ...num, fontWeight: 700 }}>{t?.oldReplied}/{t?.oldContacts}</td>
                  <td style={{ ...num, fontWeight: 700, color: t && t.awaiting > 0 ? 'var(--sos-danger, #b91c1c)' : undefined }}>{t?.awaiting}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Awaiting-reply list */}
      {report && report.awaitingContacts.length > 0 ? (
        <GlassCard variant="default" padded={false} glow="warm">
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Clock size={16} style={{ color: 'var(--sos-danger, #b91c1c)' }} />
            <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>Still awaiting a reply</h2>
            <span className="sos-text-faint" style={{ fontSize: 12 }}>
              Contacts who messaged and got no human reply. &ldquo;Returning&rdquo; = someone the team had spoken to before.
            </span>
            <span style={{ marginLeft: 'auto' }}>
              <StatusBadge tone="danger" size="sm" dot={false}>
                {report.awaitingTruncated ? `${report.awaitingContacts.length}+` : report.awaitingContacts.length}
              </StatusBadge>
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={th}>Rep</th>
                  <th style={th}>Contact</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Last message</th>
                  <th style={{ ...th, textAlign: 'right' }}>Type</th>
                </tr>
              </thead>
              <tbody>
                {report.awaitingContacts.map((a, i) => (
                  <tr key={`${a.phone ?? 'na'}-${i}`}>
                    <td style={td}>{a.repName}</td>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{a.contact ?? '(no name)'}</td>
                    <td style={{ ...td, fontFamily: 'var(--sos-font-mono, monospace)' }}>{a.phone ?? '—'}</td>
                    <td style={td}>{a.lastInboundAt ? `${pktTime(a.lastInboundAt)} PKT` : '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <span
                        style={{
                          borderRadius: 999,
                          padding: '2px 9px',
                          fontSize: 11,
                          fontWeight: 600,
                          background: a.isOld ? 'rgba(180,83,9,0.12)' : 'rgba(7,89,133,0.12)',
                          color: a.isOld ? '#b45309' : '#075985',
                        }}
                      >
                        {a.isOld ? 'Returning' : 'New'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.awaitingTruncated ? (
            <div className="sos-text-faint" style={{ padding: '10px 18px', fontSize: 12 }}>
              Showing the first {report.awaitingContacts.length}. Narrow the period to see the full list.
            </div>
          ) : null}
        </GlassCard>
      ) : null}
    </div>
  );
}
