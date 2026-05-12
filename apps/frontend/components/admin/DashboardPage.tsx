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
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '../shared/DataTable';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PageHeader } from '../shared/PageHeader';
import { StatCard } from '../shared/StatCard';
import { apiFetch } from '@/lib/api-client';

interface TopAgent {
  employeeId: string | null;
  name: string;
  leadCount: number;
}

interface DashboardSummary {
  // Legacy fields
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
  // New widgets
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
  {
    key: 'action',
    header: 'Action',
    render: (row) => row.action.replace(/_/g, ' '),
  },
  {
    key: 'entityType',
    header: 'Entity',
    render: (row) => row.entityType,
  },
  {
    key: 'actor',
    header: 'Actor',
    render: (row) => row.actor?.email ?? 'System',
  },
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

  if (loading && !summary) {
    return <LoadingState message="Loading dashboard..." />;
  }

  if (error && !summary) {
    return <ErrorState message="Unable to load dashboard" details={error} onRetry={() => void loadDashboard()} />;
  }

  if (!summary) return null;

  const alerts = buildSystemAlerts(summary);

  return (
    <div className="space-y-6">
      {/* ---- Hero ---- */}
      <section
        className="rounded-[28px] border px-5 py-6 sm:px-6"
        style={{
          borderColor: 'var(--color-border)',
          background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface-muted) 100%)',
        }}
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <span
              className="inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
              style={{
                backgroundColor: 'var(--color-surface-subtle)',
                color: 'var(--color-text-secondary)',
              }}
            >
              Live operations overview
            </span>

            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl" style={{ color: 'var(--color-text-primary)' }}>
                Admin Dashboard
              </h2>
              <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: 'var(--color-text-muted)' }}>
                Unified view across sales pipeline, WhatsApp conversations, processing cases, finance, and audit.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span
                className="rounded-full px-3 py-1.5 text-sm font-medium"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
              >
                {summary.activeWhatsAppThreads} active WhatsApp threads
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-sm font-medium"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
              >
                {summary.pendingProcessingCases} cases in processing
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-sm font-medium"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
              >
                {formatCurrency(summary.paymentsThisMonthAmount)} this month
              </span>
            </div>
          </div>

          <button
            onClick={() => void loadDashboard()}
            className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary-600)', color: 'var(--color-text-inverse)' }}
          >
            {loading ? 'Refreshing...' : 'Refresh dashboard'}
          </button>
        </div>
      </section>

      {/* ---- Section: Sales / Leads ---- */}
      <DashboardSection title="Sales pipeline">
        <StatCard label="Total Leads" value={summary.totalLeads} hint={`${summary.newLeads} in NEW status`} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Leads Today" value={summary.leadsToday} hint="New inquiries added today" icon={<Activity className="h-5 w-5" />} />
        <StatCard label="Assigned Leads" value={summary.assignedLeads} hint={`${summary.unassignedLeads} unassigned`} icon={<UserCheck className="h-5 w-5" />} />
        <StatCard label="Overdue Follow-ups" value={summary.overdueFollowUps} hint="Past their due date" icon={<AlertTriangle className="h-5 w-5" />} />
      </DashboardSection>

      {/* ---- Section: WhatsApp ---- */}
      <DashboardSection title="WhatsApp CRM">
        <StatCard
          label="Active conversations"
          value={summary.activeWhatsAppThreads}
          hint="OPEN or PENDING threads"
          icon={<MessageSquare className="h-5 w-5" />}
        />
        <StatCard
          label="Unassigned conversations"
          value={summary.whatsappUnassigned}
          hint="No sales rep yet"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </DashboardSection>

      {/* ---- Section: Processing / Clients ---- */}
      <DashboardSection title="Clients & processing">
        <StatCard label="Total Clients" value={summary.activeClients} hint={`${summary.openCases} legacy open cases`} icon={<BriefcaseBusiness className="h-5 w-5" />} />
        <StatCard label="Cases in processing" value={summary.pendingProcessingCases} hint="Not yet completed or cancelled" icon={<ClipboardList className="h-5 w-5" />} />
        <StatCard label="Pending Documents" value={summary.pendingDocuments} hint="Awaiting review or upload" icon={<FileText className="h-5 w-5" />} />
        <StatCard label="Appointments today" value={summary.appointmentsToday} hint="Scheduled or confirmed" icon={<CalendarDays className="h-5 w-5" />} />
      </DashboardSection>

      {/* ---- Section: Finance ---- */}
      <DashboardSection title="Finance">
        <StatCard
          label="Verified today"
          value={formatCurrency(summary.paymentsTodayAmount)}
          hint="Payments verified in the last 24h"
          icon={<BadgeDollarSign className="h-5 w-5" />}
        />
        <StatCard
          label="This month"
          value={formatCurrency(summary.paymentsThisMonthAmount)}
          hint="Month-to-date verified revenue"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          label="Overdue invoices"
          value={summary.overdueInvoices}
          hint="Need finance attention"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </DashboardSection>

      {/* ---- Sales team performance ---- */}
      <section
        className="rounded-[28px] border p-4 sm:p-6"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <PageHeader
          title="Sales team — top performers"
          description="Agents by lead count over the last 30 days"
        />
        {summary.topAgents.length === 0 ? (
          <div
            style={{
              padding: 16,
              fontSize: 13,
              color: 'var(--color-text-muted)',
              textAlign: 'center',
            }}
          >
            No agent activity in the last 30 days.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: idx === 0 ? 'var(--sos-status-success-soft)' : 'var(--sos-surface-hover)',
                      color: idx === 0 ? 'var(--sos-status-success)' : 'var(--sos-text-muted)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {idx + 1}
                  </span>
                  <span style={{ minWidth: 0, flex: 1, fontSize: 13, fontWeight: 600 }}>{agent.name}</span>
                  <div
                    style={{
                      flex: 2,
                      height: 6,
                      borderRadius: 999,
                      background: 'var(--sos-surface-hover)',
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
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: 'var(--sos-text-primary)',
                      minWidth: 60,
                      textAlign: 'right',
                    }}
                  >
                    {agent.leadCount} leads
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- System alerts ---- */}
      {alerts.length > 0 ? (
        <section
          className="rounded-[28px] border p-4 sm:p-6"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <PageHeader title="System alerts" description="Things that need someone's attention right now" />
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
        </section>
      ) : null}

      {/* ---- Recent activity ---- */}
      <section
        className="rounded-[28px] border p-4 sm:p-6"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <PageHeader title="Recent activity" description="Latest sensitive actions captured by the platform audit trail" />
        <DataTable columns={auditColumns} data={recentAuditLogs} rowKey={(row) => row.id} emptyMessage="No audit activity yet." />
      </section>
    </div>
  );
}

// ---------- Reusable widget section --------------------------------------

function DashboardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}
