'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Briefcase, Clock, FileWarning } from 'lucide-react';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PageHeader } from '../shared/PageHeader';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { apiFetch } from '@/lib/api-client';
import { useAdminSession } from '../layout/AdminShell';

interface OfficerWorkload {
  officerId: string | null;
  name: string;
  activeCases: number;
}

interface StageRow {
  stage: string;
  count: number;
}

interface IntakeRow {
  id: string;
  service: string;
  targetCountry: string | null;
  priority: string;
  createdAt: string;
  clientName: string | null;
  clientPhone: string | null;
}

interface BreachedRow {
  id: string;
  stage: string;
  service: string;
  targetCountry: string | null;
  slaDueAt: string | null;
  officerName: string | null;
  clientName: string | null;
}

interface AdminOverview {
  totals: {
    active: number;
    newIntake: number;
    slaBreached: number;
  };
  stageBreakdown: StageRow[];
  officerWorkload: OfficerWorkload[];
  recentIntake: IntakeRow[];
  breachedCases: BreachedRow[];
}

const STAGE_LABEL: Record<string, string> = {
  INTAKE_PENDING: 'Intake pending',
  DOCUMENTS_COLLECTION: 'Documents collection',
  DOCUMENTS_UNDER_REVIEW: 'Documents under review',
  DOCUMENTS_INCOMPLETE: 'Documents incomplete',
  DOCUMENTS_COMPLETE: 'Documents complete',
  READY_FOR_SUBMISSION: 'Ready for submission',
  SUBMITTED: 'Submitted',
  UNDER_AUTHORITY_REVIEW: 'Under authority review',
  ADDITIONAL_INFO_REQUESTED: 'Additional info requested',
  DECISION_RECEIVED: 'Decision received',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  APPEAL_IN_PROGRESS: 'Appeal in progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const PRIORITY_TONE: Record<string, string> = {
  CRITICAL: 'var(--sos-status-danger)',
  URGENT: 'var(--sos-status-danger)',
  NORMAL: 'var(--sos-status-info)',
  LOW: 'var(--sos-text-muted)',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDateOnly(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function ProcessingAdminPage() {
  const { user } = useAdminSession();
  const canView = user.permissions.includes('processing.case.view_all');

  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<AdminOverview>('/processing/admin-overview');
      setData(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load processing overview');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [canView]);

  if (!canView) return <PermissionDeniedState />;
  if (loading && !data) return <LoadingState message="Loading processing overview..." />;
  if (error && !data) {
    return <ErrorState message="Unable to load processing overview" details={error} onRetry={() => void load()} />;
  }
  if (!data) return null;

  const maxOfficer = data.officerWorkload[0]?.activeCases || 1;
  const maxStage = Math.max(...data.stageBreakdown.map((s) => s.count), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Processing overview"
        description="Manager view embedded inside the admin shell. Stage breakdown, officer workload, intake queue, SLA-breached cases."
      />

      {/* Totals */}
      <div className="grid gap-4 sm:grid-cols-3">
        <TotalTile label="Active cases" value={data.totals.active} icon={<Briefcase size={16} />} />
        <TotalTile label="New intake" value={data.totals.newIntake} icon={<Clock size={16} />} accent="info" />
        <TotalTile label="SLA breached" value={data.totals.slaBreached} icon={<AlertTriangle size={16} />} accent="danger" />
      </div>

      {/* Stage breakdown */}
      <section
        className="rounded-[28px] border p-4 sm:p-6"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <PageHeader title="Cases by stage" description="Where the active book of work sits right now" />
        {data.stageBreakdown.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 12, fontSize: 13 }}>No active cases.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.stageBreakdown.map((s) => (
              <div
                key={s.stage}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  background: 'var(--sos-surface-1)',
                  border: '1px solid var(--sos-border-subtle)',
                  borderRadius: 'var(--sos-radius-sm)',
                }}
              >
                <span style={{ minWidth: 200, fontSize: 13, fontWeight: 600 }}>
                  {STAGE_LABEL[s.stage] ?? s.stage}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 6,
                    borderRadius: 999,
                    background: 'var(--sos-surface-hover)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${(s.count / maxStage) * 100}%`,
                      height: '100%',
                      background: 'var(--sos-brand-gradient)',
                    }}
                  />
                </div>
                <span style={{ minWidth: 50, textAlign: 'right', fontSize: 13, fontWeight: 700 }}>
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Officer workload */}
      <section
        className="rounded-[28px] border p-4 sm:p-6"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <PageHeader title="Officer workload" description="Active cases assigned to each processing officer" />
        {data.officerWorkload.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 12, fontSize: 13 }}>No active cases assigned yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.officerWorkload.map((o) => (
              <div
                key={o.officerId ?? o.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  background: 'var(--sos-surface-1)',
                  border: '1px solid var(--sos-border-subtle)',
                  borderRadius: 'var(--sos-radius-sm)',
                }}
              >
                <span style={{ minWidth: 180, fontSize: 13, fontWeight: 600 }}>{o.name}</span>
                <div
                  style={{
                    flex: 1,
                    height: 6,
                    borderRadius: 999,
                    background: 'var(--sos-surface-hover)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${(o.activeCases / maxOfficer) * 100}%`,
                      height: '100%',
                      background: 'var(--sos-brand-primary)',
                    }}
                  />
                </div>
                <span style={{ minWidth: 70, textAlign: 'right', fontSize: 13, fontWeight: 700 }}>
                  {o.activeCases} cases
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent intake + SLA breached */}
      <div className="grid gap-6 xl:grid-cols-2">
        <section
          className="rounded-[28px] border p-4 sm:p-6"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <PageHeader title="Recent intake" description="Newest cases waiting to be acknowledged" />
          {data.recentIntake.length === 0 ? (
            <div className="sos-text-muted" style={{ padding: 12, fontSize: 13 }}>Nothing waiting in intake.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.recentIntake.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--sos-surface-1)',
                    border: '1px solid var(--sos-border-subtle)',
                    borderRadius: 'var(--sos-radius-sm)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{c.clientName ?? 'Unknown client'}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: 'var(--sos-status-info-soft)',
                        color: PRIORITY_TONE[c.priority] ?? 'var(--sos-status-info)',
                      }}
                    >
                      {c.priority.toLowerCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {c.service} · {c.targetCountry ?? '—'} · arrived {fmtDate(c.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          className="rounded-[28px] border p-4 sm:p-6"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <PageHeader
            title="SLA breached"
            description="Cases past their SLA deadline. Oldest first."
          />
          {data.breachedCases.length === 0 ? (
            <div className="sos-text-muted" style={{ padding: 12, fontSize: 13 }}>No SLA breaches. </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.breachedCases.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--sos-status-danger-soft)',
                    border: '1px solid var(--sos-status-danger-border)',
                    borderRadius: 'var(--sos-radius-sm)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{c.clientName ?? 'Unknown client'}</span>
                    <FileWarning size={14} style={{ color: 'var(--sos-status-danger)' }} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {STAGE_LABEL[c.stage] ?? c.stage} · {c.officerName ?? 'Unassigned'} · due {fmtDateOnly(c.slaDueAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function TotalTile({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  accent?: 'info' | 'danger';
}) {
  const color =
    accent === 'danger'
      ? 'var(--sos-status-danger)'
      : accent === 'info'
        ? 'var(--sos-status-info)'
        : 'var(--sos-brand-primary-strong)';
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--sos-radius-md)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 6,
        }}
      >
        {icon}
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
