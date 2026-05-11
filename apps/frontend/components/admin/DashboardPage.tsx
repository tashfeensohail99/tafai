'use client';

import { Activity, BriefcaseBusiness, ClipboardList, FileText, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '../shared/DataTable';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PageHeader } from '../shared/PageHeader';
import { StatCard } from '../shared/StatCard';
import { apiFetch } from '@/lib/api-client';

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

  return (
    <div className="space-y-6">
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
                Unified view across lead activity, client workload, documentation, finance, and audit visibility.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span
                className="rounded-full px-3 py-1.5 text-sm font-medium"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
              >
                {summary?.openCases ?? 0} open cases
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-sm font-medium"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
              >
                {summary?.appointmentsToday ?? 0} appointments today
              </span>
              <span
                className="rounded-full px-3 py-1.5 text-sm font-medium"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
              >
                {summary?.overdueInvoices ?? 0} overdue invoices
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total Leads" value={summary?.totalLeads ?? 0} hint={`${summary?.newLeads ?? 0} new`} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Leads Today" value={summary?.leadsToday ?? 0} hint="New inquiries added today" icon={<Activity className="h-5 w-5" />} />
        <StatCard label="Active Clients" value={summary?.activeClients ?? 0} hint={`${summary?.openCases ?? 0} open cases`} icon={<BriefcaseBusiness className="h-5 w-5" />} />
        <StatCard label="Pending Documents" value={summary?.pendingDocuments ?? 0} hint={`${summary?.appointmentsToday ?? 0} appointments today`} icon={<FileText className="h-5 w-5" />} />
        <StatCard label="Audit Events Today" value={summary?.auditEventsToday ?? 0} hint={`${summary?.activeEmployees ?? 0} active employees`} icon={<ClipboardList className="h-5 w-5" />} />
      </div>

      <section
        className="rounded-[28px] border p-4 sm:p-6"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <PageHeader title="Recent Audit Activity" description="Latest sensitive actions captured by the platform audit trail." />
        <DataTable columns={auditColumns} data={recentAuditLogs} rowKey={(row) => row.id} emptyMessage="No audit activity yet." />
      </section>
    </div>
  );
}