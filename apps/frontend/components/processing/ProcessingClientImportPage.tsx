'use client';
// Bulk client import — a manager uploads an xlsx/csv, previews how every row
// resolves (officer / sales rep / program / dupe), then commits. The commit
// creates each Client + INTAKE case and auto-assigns the named officer.

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  ShieldAlert,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { labelForServiceCode } from '@/lib/service-types';
import {
  previewProcessingImport,
  commitProcessingImport,
  type ImportResult,
  type ImportRowResult,
} from '@/lib/processing';
import { useProcessingSession } from '@/components/layout/ProcessingShell';

function outcomeTone(o: ImportRowResult['outcome']): BadgeTone {
  switch (o) {
    case 'READY': return 'success';
    case 'READY_UNASSIGNED': return 'warning';
    case 'DUPLICATE': return 'neutral';
    case 'BLOCKED': return 'danger';
    default: return 'neutral';
  }
}

const OUTCOME_LABEL: Record<ImportRowResult['outcome'], string> = {
  READY: 'Ready',
  READY_UNASSIGNED: 'No officer',
  DUPLICATE: 'Duplicate',
  BLOCKED: 'Blocked',
};

export function ProcessingClientImportPage() {
  const { user } = useProcessingSession();
  const isManager = user.permissions.includes('processing.case.assign');

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [committed, setCommitted] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!isManager) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '40px 20px', textAlign: 'center' }}>
          <ShieldAlert size={40} style={{ color: 'var(--sos-status-warning)' }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Manager access required</div>
          <div style={{ fontSize: 14, color: 'var(--sos-text-muted)' }}>
            Bulk client import is available to Processing managers only.
          </div>
        </div>
      </GlassCard>
    );
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setCommitted(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  function onPick(f: File | null) {
    setFile(f);
    setPreview(null);
    setCommitted(null);
    setError(null);
  }

  async function runPreview() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      setPreview(await previewProcessingImport(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }

  async function runCommit() {
    if (!file) return;
    setCommitting(true);
    setError(null);
    try {
      setCommitted(await commitProcessingImport(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setCommitting(false);
    }
  }

  const importable = preview ? preview.counts.ready + preview.counts.unassigned : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Import Clients"
        description="Bulk-create processing clients from a spreadsheet (xlsx/csv) and auto-assign each to its processing officer. Preview first — nothing is created until you confirm."
      />

      {error ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sos-status-danger)', fontSize: 13 }}>
            <AlertTriangle size={15} /> {error}
          </div>
        </GlassCard>
      ) : null}

      {/* --- Success summary --- */}
      {committed?.committed ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={28} style={{ color: 'var(--sos-status-success)' }} />
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Import complete</div>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 14 }}>
              <span><strong style={{ color: 'var(--sos-status-success)' }}>{committed.committed.created}</strong> created</span>
              <span><strong>{committed.committed.skipped}</strong> skipped (duplicates / blocked)</span>
              {committed.committed.failed > 0 ? (
                <span style={{ color: 'var(--sos-status-danger)' }}><strong>{committed.committed.failed}</strong> failed</span>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Link href={'/processing/cases' as Route}>
                <PrimaryButton iconRight={<ArrowRight size={14} />}>Go to My Cases</PrimaryButton>
              </Link>
              <SecondaryButton onClick={reset}>Import another file</SecondaryButton>
            </div>
          </div>
        </GlassCard>
      ) : (
        <>
          {/* --- Upload --- */}
          <GlassCard variant="panel" padded="md">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              />
              <SecondaryButton iconLeft={<Upload size={14} />} onClick={() => fileInput.current?.click()}>
                {file ? 'Choose a different file' : 'Choose spreadsheet'}
              </SecondaryButton>
              {file ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--sos-text-primary)' }}>
                  <FileSpreadsheet size={15} style={{ color: 'var(--sos-brand-accent)' }} />
                  {file.name}
                  <button type="button" onClick={reset} aria-label="Clear" style={{ background: 'transparent', border: 'none', color: 'var(--sos-text-muted)', cursor: 'pointer' }}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
                  Columns: Case ID, Client Name, Contact Number, Email, Program, Sale Person, Signup date, Processing officer, Case Status
                </span>
              )}
              <div style={{ marginLeft: 'auto' }}>
                <PrimaryButton onClick={runPreview} disabled={!file || loading} iconLeft={loading ? <Loader2 size={14} className="sos-spin" /> : <UploadCloud size={14} />}>
                  {loading ? 'Reading…' : 'Preview'}
                </PrimaryButton>
              </div>
            </div>
          </GlassCard>

          {/* --- Preview --- */}
          {preview ? (
            <GlassCard variant="panel" padded={false}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '14px 16px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                  {preview.totalRows} row{preview.totalRows !== 1 ? 's' : ''} · {preview.sourceFormat.toUpperCase()}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <StatusBadge tone="success" size="sm">{preview.counts.ready} ready</StatusBadge>
                  {preview.counts.unassigned > 0 ? <StatusBadge tone="warning" size="sm">{preview.counts.unassigned} no officer</StatusBadge> : null}
                  {preview.counts.duplicates > 0 ? <StatusBadge tone="neutral" size="sm">{preview.counts.duplicates} duplicate</StatusBadge> : null}
                  {preview.counts.blocked > 0 ? <StatusBadge tone="danger" size="sm">{preview.counts.blocked} blocked</StatusBadge> : null}
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <PrimaryButton
                    onClick={runCommit}
                    disabled={committing || importable === 0}
                    iconLeft={committing ? <Loader2 size={14} className="sos-spin" /> : <CheckCircle2 size={14} />}
                  >
                    {committing ? 'Importing…' : `Import ${importable} client${importable !== 1 ? 's' : ''}`}
                  </PrimaryButton>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 1040 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '40px 1.4fr 1fr 1fr 1fr 1fr 110px', gap: 10, padding: '8px 16px', fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
                    <span>#</span>
                    <span>Client</span>
                    <span>Program</span>
                    <span>Officer</span>
                    <span>Sales rep</span>
                    <span>Case status</span>
                    <span>Outcome</span>
                  </div>
                  {preview.rows.map((r) => (
                    <div key={r.rowNumber} style={{ display: 'grid', gridTemplateColumns: '40px 1.4fr 1fr 1fr 1fr 1fr 110px', gap: 10, padding: '10px 16px', fontSize: 12.5, alignItems: 'start', borderBottom: '1px solid var(--sos-border-subtle)' }}>
                      <span style={{ color: 'var(--sos-text-faint)' }}>{r.rowNumber}</span>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--sos-text-primary)' }}>{r.clientName || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>
                          {r.email || 'no email'}{r.externalRef ? ` · #${r.externalRef}` : ''}{r.signupDate ? ` · ${r.signupDate}` : ''}
                        </div>
                      </div>
                      <div style={{ color: r.serviceCode ? 'var(--sos-text-primary)' : 'var(--sos-status-danger)' }}>
                        {r.serviceCode ? labelForServiceCode(r.serviceCode) : (r.program || '—')}
                        {r.programCode ? <span style={{ color: 'var(--sos-text-muted)' }}> · {r.programCode}</span> : null}
                      </div>
                      <span style={{ color: r.officer ? (r.officerMatched ? 'var(--sos-text-primary)' : 'var(--sos-status-warning)') : 'var(--sos-text-faint)' }}>
                        {r.officer ? `${r.officer}${r.officerMatched ? '' : ' ⚠'}` : '—'}
                      </span>
                      <span style={{ color: r.salesPerson ? (r.salesPersonMatched ? 'var(--sos-text-primary)' : 'var(--sos-status-warning)') : 'var(--sos-text-faint)' }}>
                        {r.salesPerson ? `${r.salesPerson}${r.salesPersonMatched ? '' : ' ⚠'}` : '—'}
                      </span>
                      <span style={{ color: 'var(--sos-text-secondary)' }}>{r.caseStatus || '—'}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <StatusBadge tone={outcomeTone(r.outcome)} size="sm">{OUTCOME_LABEL[r.outcome]}</StatusBadge>
                        {r.warnings.length > 0 ? (
                          <span title={r.warnings.join('\n')} style={{ fontSize: 10.5, color: 'var(--sos-text-muted)', cursor: 'help' }}>
                            {r.warnings.length} note{r.warnings.length !== 1 ? 's' : ''}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          ) : null}
        </>
      )}
    </div>
  );
}
