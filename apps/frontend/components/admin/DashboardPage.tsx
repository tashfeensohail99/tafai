'use client';

import {
  Activity,
  AlertTriangle,
  BadgeDollarSign,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  FileText,
  MessageSquare,
  RefreshCw,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '../shared/DataTable';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import {
  GlassCard,
  MetricCard,
  PageHeader,
  PrimaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import { apiFetch } from '@/lib/api-client';

interface TopAgent {
  employeeId: string | null;
  name: string;
  leadCount: number;
}

interface DashboardSummary {
  totalLeads: number;
  newLeads: number;
  leadsToday: number;
  activeClients: number;
  openCases: number;
  pendingDocuments: number;
  activeEmployees: number;
  overdueInvoices: number;
  appointmentsToday: number;
  auditEventsToday: number;
  assignedLeads: number;
  unassignedLeads: number;
  activeWhatsAppThreads: number;
  whatsappUnassigned: number;
  pendingProcessingCases: number;
  overdueFollowUps: number;
  paymentsTodayAmount: number;
  paymentsThisMonthAmount: number;
  topAgents: TopAgent[];
}

interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  createdAt: string;
  actor?: { email?: string | null } | null;
}

const auditColumns: DataTableColumn<AuditLogRow>[] = [
  { key: 'action', header: 'Action', render: (row) => row.action.replace(/_/g, ' ') },
  { key: 'entityType', header: 'Entity', render: (row) => row.entityType },
  { key: 'actor', header: 'Actor', render: (row) => row.actor?.email ?? 'System' },
  {
    key: 'createdAt',
    header: 'Created',
    render: (row) => new Date(row.createdAt).toLocaleString(),
  },
];

function formatCurrency(amount: number): string {
  if (!amount) return 'CAD 0';
  return `CAD ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

interface AlertEntry {
  severity: 'danger' | 'warning' | 'info';
  message: string;
}

function buildSystemAlerts(s: DashboardSummary): AlertEntry[] {
  const alerts: AlertEntry[] = [];
  if (s.overdueFollowUps > 0) {
    alerts.push({
      severity: 'warning',
      message: `${s.overdueFollowUps} overdue follow-up${s.overdueFollowUps === 1 ? '' : 's'} — sales agents have past-due tasks`,
    });
  }
  if (s.unassignedLeads > 0) {
    alerts.push({
      severity: 'info',
      message: `${s.unassignedLeads} unassigned lead${s.unassignedLeads === 1 ? '' : 's'} in the pipeline`,
    });
  }
  if (s.whatsappUnassigned > 0) {
    alerts.push({
      severity: 'info',
      message: `${s.whatsappUnassigned} unassigned WhatsApp conversation${s.whatsappUnassigned === 1 ? '' : 's'}`,
    });
  }
  if (s.overdueInvoices > 0) {
    alerts.push({
      severity: 'danger',
      message: `${s.overdueInvoices} overdue invoice${s.overdueInvoices === 1 ? '' : 's'} need finance attention`,
    });
  }
  if (s.pendingDocuments > 20) {
    alerts.push({
      severity: 'info',
      message: `${s.pendingDocuments} documents pending review`,
    });
  }
  return alerts;
}

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [recentAuditLogs, setRecentAuditLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const [summaryResponse, auditResponse] = await Promise.all([
        apiFetch<DashboardSummary>('/reports/dashboard'),
        apiFetch<AuditLogRow[]>('/audit-log?limit=8'),
      ]);
      setSummary(summaryResponse);
      setRecentAuditLogs(auditResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  if (loading && !summary) return <LoadingState message="Loading dashboard..." />;
  if (error && !summary) {
    return (
      <ErrorState
        message="Unable to load dashboard"
        details={error}
        onRetry={() => void loadDashboard()}
      />
    );
  }
  if (!summary) return null;

  const alerts = buildSystemAlerts(summary);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        eyebrow="Admin"
        title="Operations dashboard"
        description="Unified view across sales pipeline, WhatsApp conversations, processing cases, finance, and audit."
        actions={
          <PrimaryButton
            onClick={() => void loadDashboard()}
            iconLeft={<RefreshCw size={14} />}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </PrimaryButton>
        }
      />

      {/* ---- Section: Sales / Leads ---- */}
      <DashboardSection title="Sales pipeline">
        <MetricCard
          label="Total leads"
          value={summary.totalLeads}
          hint={`${summary.newLeads} in NEW status`}
          tone="accent"
          Icon={Users}
        />
        <MetricCard
          label="Leads today"
          value={summary.leadsToday}
          hint="Inquiries added today"
          tone="info"
          Icon={Activity}
        />
        <MetricCard
          label="Assigned leads"
          value={summary.assignedLeads}
          hint={`${summary.unassignedLeads} unassigned`}
          tone="success"
          Icon={UserCheck}
        />
        <MetricCard
          label="Overdue follow-ups"
          value={summary.overdueFollowUps}
          hint="Past their due date"
          tone={summary.overdueFollowUps > 0 ? 'warning' : 'neutral'}
          Icon={AlertTriangle}
        />
      </DashboardSection>

      {/* ---- Section: WhatsApp ---- */}
      <DashboardSection title="WhatsApp CRM">
        <MetricCard
          label="Active conversations"
          value={summary.activeWhatsAppThreads}
          hint="OPEN or PENDING threads"
          tone="accent"
          Icon={MessageSquare}
        />
        <MetricCard
          label="Unassigned conversations"
          value={summary.whatsappUnassigned}
          hint="No sales rep yet"
          tone={summary.whatsappUnassigned > 0 ? 'warning' : 'neutral'}
          Icon={AlertTriangle}
        />
      </DashboardSection>

      {/* ---- Section: Clients / Processing ---- */}
      <DashboardSection title="Clients & processing">
        <MetricCard
          label="Total clients"
          value={summary.activeClients}
          hint={`${summary.openCases} legacy open cases`}
          tone="accent"
          Icon={BriefcaseBusiness}
        />
        <MetricCard
          label="Cases in processing"
          value={summary.pendingProcessingCases}
          hint="Not yet completed or cancelled"
          tone="info"
          Icon={ClipboardList}
        />
        <MetricCard
          label="Pending documents"
          value={summary.pendingDocuments}
          hint="Awaiting review or upload"
          tone="warning"
          Icon={FileText}
        />
        <MetricCard
          label="Appointments today"
          value={summary.appointmentsToday}
          hint="Scheduled or confirmed"
          tone="success"
          Icon={CalendarDays}
        />
      </DashboardSection>

      {/* ---- Section: Finance ---- */}
      <DashboardSection title="Finance">
        <MetricCard
          label="Verified today"
          value={formatCurrency(summary.paymentsTodayAmount)}
          hint="Payments verified in the last 24h"
          tone="success"
          Icon={BadgeDollarSign}
        />
        <MetricCard
          label="This month"
          value={formatCurrency(summary.paymentsThisMonthAmount)}
          hint="Month-to-date verified revenue"
          tone="accent"
          Icon={TrendingUp}
        />
        <MetricCard
          label="Overdue invoices"
          value={summary.overdueInvoices}
          hint="Need finance attention"
          tone={summary.overdueInvoices > 0 ? 'danger' : 'neutral'}
          Icon={AlertTriangle}
        />
      </DashboardSection>

      {/* ---- Top performers ---- */}
      <GlassCard variant="panel" padded="lg">
        <div className="sos-eyebrow">Sales team · top performers (last 30d)</div>
        <h2
          className="sos-title"
          style={{ fontSize: 'var(--sos-text-lg)', marginTop: 6, marginBottom: 16 }}
        >
          Agents by lead count
        </h2>
        {summary.topAgents.length === 0 ? (
          <div
            className="sos-text-muted"
            style={{ padding: 12, textAlign: 'center', fontSize: 13 }}
          >
            No agent activity in the last 30 days.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {summary.topAgents.map((agent, idx) => {
              const max = summary.topAgents[0]?.leadCount || 1;
              const pct = Math.round((agent.leadCount / max) * 100);
              return (
                <div
                  key={agent.employeeId ?? idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px',
                    borderRadius: 'var(--sos-radius-sm)',
                    background: 'var(--sos-surface-1)',
                    border: '1px solid var(--sos-border-subtle)',
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background:
                        idx === 0
                          ? 'var(--sos-status-success-soft)'
                          : 'var(--sos-surface-3)',
                      color:
                        idx === 0 ? 'var(--sos-status-success)' : 'var(--sos-text-muted)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {idx + 1}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--sos-text-primary)',
                    }}
                  >
                    {agent.name}
                  </span>
                  <div
                    style={{
                      flex: 2,
                      height: 6,
                      borderRadius: 999,
                      background: 'var(--sos-surface-progress-track)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: 'var(--sos-brand-gradient)',
                      }}
                    />
                  </div>
                  <StatusBadge tone={idx === 0 ? 'success' : 'neutral'} size="sm">
                    {agent.leadCount} leads
                  </StatusBadge>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* ---- System alerts ---- */}
      {alerts.length > 0 ? (
        <GlassCard variant="panel" padded="lg">
          <div className="sos-eyebrow">System alerts</div>
          <h2
            className="sos-title"
            style={{ fontSize: 'var(--sos-text-lg)', marginTop: 6, marginBottom: 14 }}
          >
            Things that need attention
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map((a, i) => (
              <div
                key={i}
                className={`sos-banner sos-banner--${a.severity}`}
                style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <AlertTriangle size={14} />
                <span>{a.message}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}

      {/* ---- Recent activity ---- */}
      <GlassCard variant="panel" padded="lg">
        <div className="sos-eyebrow">Audit</div>
        <h2
          className="sos-title"
          style={{ fontSize: 'var(--sos-text-lg)', marginTop: 6, marginBottom: 14 }}
        >
          Recent activity
        </h2>
        <DataTable
          columns={auditColumns}
          data={recentAuditLogs}
          rowKey={(row) => row.id}
          emptyMessage="No audit activity yet."
        />
      </GlassCard>
    </div>
  );
}

function DashboardSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="sos-eyebrow">{title}</div>
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        {children}
      </div>
    </section>
  );
}
