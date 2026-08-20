'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, FileText, Loader2, CalendarClock } from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  EmptyState,
  PrimaryButton,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { useJrSession } from '@/components/layout/JrShell';
import {
  assignJrMatter,
  fetchJrArtifacts,
  fetchJrAssociates,
  fetchJrMatter,
  fetchJrMatterDeadlines,
  jrDueInfo,
  jrFmtDate,
  jrHumanize,
  jrStageLabel,
  jrStageTone,
  type JrArtifactsGrouped,
  type JrAssociate,
  type JrDeadlineRow,
  type JrMatter,
} from '@/lib/jr';

/**
 * JR matter detail — read-only for v1 (the only mutation is assigning an
 * associate, gated by `jr.matter.assign`). Overview + deadlines + grouped
 * artifacts. All three reads are matter-access-checked server-side.
 */

function deadlineStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'MET':
      return 'success';
    case 'MISSED':
      return 'danger';
    case 'WAIVED':
    case 'SUPERSEDED':
      return 'neutral';
    case 'PENDING':
    default:
      return 'info';
  }
}

function artifactStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'COUNSEL_APPROVED':
    case 'FILED':
    case 'SERVED':
      return 'success';
    case 'COUNSEL_REVIEW':
      return 'info';
    case 'COUNSEL_CHANGES_REQUESTED':
      return 'warning';
    case 'SUPERSEDED':
      return 'neutral';
    case 'INTERNAL_QA':
      return 'accent';
    case 'DRAFT':
    default:
      return 'neutral';
  }
}

function DefRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span style={{ fontSize: 13.5, color: 'var(--sos-text-primary)' }}>{children}</span>
    </div>
  );
}

function DetailAssignControl({
  matter,
  associates,
  onAssigned,
}: {
  matter: JrMatter;
  associates: JrAssociate[];
  onAssigned: () => void;
}) {
  const [value, setValue] = useState(matter.assignedAssociateUserId ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!value || value === matter.assignedAssociateUserId) return;
    setSaving(true);
    setErr(null);
    try {
      await assignJrMatter(matter.id, value);
      onAssigned();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to assign');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          className="sos-select"
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Assign associate"
          style={{ fontSize: 12.5, padding: '4px 8px' }}
        >
          <option value="">Unassigned…</option>
          {associates.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <PrimaryButton
          onClick={save}
          disabled={saving || !value || value === matter.assignedAssociateUserId}
          iconLeft={saving ? <Loader2 size={13} className="sos-spin" /> : undefined}
        >
          {saving ? '…' : 'Assign'}
        </PrimaryButton>
      </div>
      {err ? <span style={{ fontSize: 10.5, color: 'var(--sos-status-danger)' }}>{err}</span> : null}
    </div>
  );
}

export default function JrMatterDetailPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const { user } = useJrSession();
  const canAssign = user.permissions.includes('jr.matter.assign');

  const [matter, setMatter] = useState<JrMatter | null>(null);
  const [deadlines, setDeadlines] = useState<JrDeadlineRow[]>([]);
  const [artifacts, setArtifacts] = useState<JrArtifactsGrouped>({ folders: [] });
  const [associates, setAssociates] = useState<JrAssociate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canAssign) return;
    let cancelled = false;
    fetchJrAssociates()
      .then((list) => !cancelled && setAssociates(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canAssign]);

  useEffect(() => {
    if (!matterId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchJrMatter(matterId),
      fetchJrMatterDeadlines(matterId),
      fetchJrArtifacts(matterId),
    ])
      .then(([m, d, a]) => {
        if (cancelled) return;
        setMatter(m);
        setDeadlines(d);
        setArtifacts(a);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load matter');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [matterId, reloadKey]);

  const assignedName = useMemo(() => {
    if (!matter?.assignedAssociateUserId) return null;
    return associates.find((a) => a.id === matter.assignedAssociateUserId)?.name ?? 'Assigned';
  }, [matter, associates]);

  const backLink = (
    <Link
      href={'/jr' as Route}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}
    >
      <ArrowLeft size={14} /> Back to matters
    </Link>
  );

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--sos-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Loader2 size={16} className="sos-spin" /> Loading matter…
      </div>
    );
  }
  if (error || !matter) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PageHeader title="Matter" actions={backLink} />
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13.5 }}>
            {error ?? 'Matter not found.'}
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        eyebrow={matter.intakeType === 'INTERNAL' ? 'Internal escalation' : 'External matter'}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {matter.matterNumber}
            <StatusBadge tone={jrStageTone(matter.stage)}>{jrStageLabel(matter.stage)}</StatusBadge>
          </span>
        }
        description={matter.styleOfCause ?? undefined}
        actions={backLink}
      />

      {/* Overview */}
      <GlassCard variant="panel" padded="md">
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: 14 }}>Overview</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <DefRow label="Matter number">{matter.matterNumber}</DefRow>
          <DefRow label="Style of cause">{matter.styleOfCause ?? '—'}</DefRow>
          <DefRow label="Intake type">{matter.intakeType === 'INTERNAL' ? 'Internal escalation' : 'External'}</DefRow>
          <DefRow label="Stage">
            <StatusBadge tone={jrStageTone(matter.stage)} size="sm">{jrStageLabel(matter.stage)}</StatusBadge>
          </DefRow>
          <DefRow label="Decision maker">{jrHumanize(matter.decisionMaker) || '—'}</DefRow>
          <DefRow label="Application type">{matter.applicationType || '—'}</DefRow>
          <DefRow label="Route">{jrHumanize(matter.route) || '—'}</DefRow>
          <DefRow label="Decision communicated">
            {matter.decisionCommunicatedAt ? (
              jrFmtDate(matter.decisionCommunicatedAt)
            ) : (
              <span style={{ color: 'var(--sos-text-muted)' }}>Not set — intake pending</span>
            )}
          </DefRow>
          <DefRow label="Court file number">{matter.courtFileNumber ?? '—'}</DefRow>
          <DefRow label="Assigned associate">
            {assignedName ? (
              assignedName
            ) : canAssign && associates.length > 0 ? (
              <DetailAssignControl matter={matter} associates={associates} onAssigned={() => setReloadKey((k) => k + 1)} />
            ) : matter.assignedAssociateUserId ? (
              'Assigned'
            ) : (
              <StatusBadge tone="warning" size="sm">Unassigned</StatusBadge>
            )}
          </DefRow>
        </div>
      </GlassCard>

      {/* Deadlines */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <CalendarClock size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Deadlines</div>
        </div>
        {deadlines.length === 0 ? (
          <EmptyState
            Icon={CalendarClock}
            title="No deadlines computed yet"
            description="Set the notification date to start the clock."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {deadlines.map((d) => {
              const due = jrDueInfo(d.effectiveDueAt);
              return (
                <div
                  key={d.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)' }}
                >
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                      {d.label || jrHumanize(d.milestoneKey)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>
                      Due {jrFmtDate(d.effectiveDueAt)}
                      {!d.quotableToClient ? ' · not quotable / provisional' : ''}
                    </div>
                  </div>
                  {d.isFatal ? (
                    <StatusBadge tone="danger" size="sm" icon={<AlertTriangle size={11} />} dot={false}>
                      Fatal
                    </StatusBadge>
                  ) : null}
                  <StatusBadge tone={due.tone} size="sm">{due.label}</StatusBadge>
                  <StatusBadge tone={deadlineStatusTone(d.status)} size="sm" dot={false}>
                    {jrHumanize(d.status)}
                  </StatusBadge>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Artifacts */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <FileText size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Artifacts</div>
        </div>
        {artifacts.folders.length === 0 ? (
          <EmptyState
            Icon={FileText}
            title="No artifacts yet"
            description="Documents and court filings will appear here as they are authored."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {artifacts.folders.map((folder) => (
              <div key={folder.folder}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  {jrHumanize(folder.folder)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {folder.artifacts.map((a) => (
                    <div
                      key={a.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)' }}
                    >
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--sos-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.title}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{jrHumanize(a.artifactType)}</span>
                      <StatusBadge tone={artifactStatusTone(a.status)} size="sm" dot={false}>
                        {jrHumanize(a.status)}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
