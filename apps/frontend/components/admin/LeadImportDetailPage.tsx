'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertCircle,
  ArrowLeft,
  Download,
  Loader2,
  Pause,
  Play,
} from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  downloadErrorsCsv,
  getImportBatch,
  pauseImport,
  resumeImport,
  type LeadImportBatch,
  type LeadImportStatus,
} from '@/lib/lead-imports-api';

interface Props {
  batchId: string;
}

function statusTone(status: LeadImportStatus): BadgeTone {
  switch (status) {
    case 'QUEUED': return 'neutral';
    case 'PROCESSING': return 'info';
    case 'COMPLETED': return 'success';
    case 'FAILED': return 'danger';
    case 'PAUSED': return 'warning';
    default: return 'neutral';
  }
}

export function LeadImportDetailPage({ batchId }: Props) {
  const [batch, setBatch] = useState<LeadImportBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'pause' | 'resume' | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await getImportBatch(batchId);
      setBatch(b);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load batch');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while in-flight. Worker updates batch row every ~50ms so 2s polling
  // gives near-real-time progress without DDoS-ing the API.
  useEffect(() => {
    if (!batch) return;
    if (batch.status !== 'PROCESSING' && batch.status !== 'QUEUED') return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [batch?.status, batch, load]);

  async function handlePause() {
    setBusyAction('pause');
    try {
      await pauseImport(batchId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pause failed');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleResume() {
    setBusyAction('resume');
    try {
      await resumeImport(batchId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed');
    } finally {
      setBusyAction(null);
    }
  }

  if (loading && !batch) {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--sos-text-muted)' }}>Loading…</div>;
  }
  if (error && !batch) {
    return (
      <div style={{ padding: 24 }}>
        <Link href={'/admin/lead-imports' as Route} className="sos-btn sos-btn--ghost sos-btn--sm">
          <ArrowLeft size={13} /> Back
        </Link>
        <div style={{ marginTop: 16, padding: 24, color: 'var(--sos-status-danger)' }}>{error}</div>
      </div>
    );
  }
  if (!batch) return null;

  const processed = batch.importedCount + batch.duplicateCount + batch.invalidCount;
  const pct = batch.totalRows > 0 ? Math.round((processed / batch.totalRows) * 100) : 0;
  const canPause = batch.status === 'PROCESSING' || batch.status === 'QUEUED';
  const canResume = batch.status === 'PAUSED';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Link href={'/admin/lead-imports' as Route} className="sos-btn sos-btn--ghost sos-btn--sm" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <ArrowLeft size={13} /> Back to imports
      </Link>

      <PageHeader
        eyebrow={`Admin · ${batch.batchNumber}`}
        title={batch.name}
        description={`${batch.fileName} · uploaded ${new Date(batch.uploadedAt).toLocaleString()}${batch.uploadedBy ? ` by ${batch.uploadedBy.email}` : ''}`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <StatusBadge tone={statusTone(batch.status)} size="md">{batch.status}</StatusBadge>
            {canPause ? (
              <SecondaryButton
                iconLeft={busyAction === 'pause' ? <Loader2 size={14} className="sos-spin" /> : <Pause size={14} />}
                onClick={() => void handlePause()}
                disabled={busyAction !== null}
              >
                Pause
              </SecondaryButton>
            ) : null}
            {canResume ? (
              <PrimaryButton
                iconLeft={busyAction === 'resume' ? <Loader2 size={14} className="sos-spin" /> : <Play size={14} />}
                onClick={() => void handleResume()}
                disabled={busyAction !== null}
              >
                Resume
              </PrimaryButton>
            ) : null}
            {batch.invalidCount > 0 ? (
              <SecondaryButton
                iconLeft={<Download size={14} />}
                onClick={() => downloadErrorsCsv(batch.id, batch.batchNumber)}
              >
                Download errors
              </SecondaryButton>
            ) : null}
          </div>
        }
      />

      {error ? (
        <GlassCard variant="soft" padded="sm" style={{ borderLeft: '4px solid var(--sos-status-danger)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} style={{ color: 'var(--sos-status-danger)' }} />
          <span style={{ fontSize: 13.5, flex: 1 }}>{error}</span>
        </GlassCard>
      ) : null}

      {/* Progress + counts */}
      <GlassCard variant="panel" padded="lg">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="sos-eyebrow">Progress</div>
          <div style={{ fontSize: 13, color: 'var(--sos-text-secondary)' }}>
            {processed.toLocaleString()} / {batch.totalRows.toLocaleString()} rows · {pct}%
          </div>
        </div>
        <div style={{ height: 8, background: 'var(--sos-surface-1)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--sos-brand-primary-strong)', transition: 'width 400ms' }} />
        </div>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: 20 }}>
          <Stat label="Imported" value={batch.importedCount} tone="success" />
          <Stat label="Duplicates" value={batch.duplicateCount} tone="neutral" />
          <Stat label="Invalid" value={batch.invalidCount} tone="danger" />
          <Stat label="Assigned" value={batch.assignedCount} tone="info" />
          <Stat label="Total rows" value={batch.totalRows} tone="muted" />
        </div>
      </GlassCard>

      {/* Per-agent breakdown */}
      <GlassCard variant="panel" padded={false}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--sos-divider)' }}>
          <div className="sos-eyebrow">Round-robin distribution</div>
          <h3 className="sos-title" style={{ fontSize: 16, marginTop: 4 }}>Leads assigned per agent</h3>
        </div>
        {!batch.agentBreakdown || batch.agentBreakdown.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
            No assignments yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--sos-surface-1)' }}>
                {['Agent', 'Leads assigned'].map((h) => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid var(--sos-divider)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batch.agentBreakdown.map((row) => (
                <tr key={row.employeeId ?? 'unassigned'} style={{ borderBottom: '1px solid var(--sos-divider)' }}>
                  <td style={{ padding: '12px 16px', fontSize: 13.5, color: 'var(--sos-text-primary)' }}>{row.employeeName}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{row.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GlassCard>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'success' | 'danger' | 'info' | 'neutral' | 'muted' }) {
  const color = {
    success: 'var(--sos-status-success)',
    danger: 'var(--sos-status-danger)',
    info: 'var(--sos-brand-primary-strong)',
    neutral: 'var(--sos-text-primary)',
    muted: 'var(--sos-text-muted)',
  }[tone];
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value.toLocaleString()}</div>
    </div>
  );
}
