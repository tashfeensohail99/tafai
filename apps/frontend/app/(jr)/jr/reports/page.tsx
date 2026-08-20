'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FileText, Loader2, Sparkles, X } from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  EmptyState,
  PrimaryButton,
  Field,
  FormSelect,
} from '@/components/sales-v2/ui';
import { useJrSession } from '@/components/layout/JrShell';
import {
  createWorkReport,
  fetchReportSubjects,
  listWorkReports,
  jrFmtDate,
  workReportStatusTone,
  type WorkReportListItem,
  type WorkReportSubject,
} from '@/lib/jr';

/**
 * Judicial Review — Work Reports. A Head (jr.report.view_all) picks a subject +
 * a date range; an associate just picks a range (their own work). Compiling
 * routes straight to the report detail. Existing reports list below with status
 * + period. Backend scopes both the list and the subject roster server-side.
 */

/** Default the period to the current calendar month. */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

function GenerateCard({ onCreated }: { onCreated: () => void }) {
  const { user } = useJrSession();
  const router = useRouter();
  const canPickSubject = user.permissions.includes('jr.report.view_all');

  const range = defaultRange();
  const [subjectId, setSubjectId] = useState('');
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [subjects, setSubjects] = useState<WorkReportSubject[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canPickSubject) return;
    let cancelled = false;
    fetchReportSubjects()
      .then((list) => {
        if (cancelled) return;
        setSubjects(list);
        // Pre-select the caller when present in the roster.
        setSubjectId((cur) => cur || list.find((s) => s.id === user.id)?.id || '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canPickSubject, user.id]);

  const valid = from !== '' && to !== '' && from <= to;

  async function generate() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await createWorkReport({
        ...(canPickSubject && subjectId ? { subjectAssociateId: subjectId } : {}),
        periodFrom: from,
        periodTo: to,
      });
      onCreated();
      router.push(`/jr/reports/${res.report.id}` as Route);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to compile report');
      setSaving(false);
    }
  }

  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Sparkles size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Generate a report</div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
        {canPickSubject
          ? 'Pick an associate and a date range — the system compiles everything they did on their matters over that window.'
          : 'Pick a date range — the system compiles everything you did on your matters over that window.'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
        {canPickSubject ? (
          <FormSelect
            label="Associate"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            options={[
              { value: '', label: 'Me' },
              ...subjects.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        ) : null}
        <Field label="From">
          <input type="date" className="sos-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" className="sos-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <PrimaryButton
          onClick={generate}
          disabled={!valid || saving}
          iconLeft={saving ? <Loader2 size={14} className="sos-spin" /> : <FileText size={14} />}
        >
          {saving ? 'Compiling…' : 'Compile report'}
        </PrimaryButton>
      </div>

      {!valid && from && to ? (
        <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--sos-status-danger)' }}>
          The start date must be on or before the end date.
        </div>
      ) : null}
      {error ? (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--sos-status-danger)' }}>
          <X size={13} /> {error}
        </div>
      ) : null}
    </GlassCard>
  );
}

export default function JrReportsPage() {
  const { mode } = useJrSession();
  const [reports, setReports] = useState<WorkReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listWorkReports({ take: 100 })
      .then((rows) => {
        if (cancelled) return;
        setReports(rows);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load reports');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        eyebrow="Federal Court"
        title="Work Reports"
        description={
          mode === 'head'
            ? 'Compile a work report for any associate, then finalize it to a filed PDF.'
            : 'Compile your work log for a period, enrich it, and finalize it to a PDF.'
        }
      />

      <GenerateCard onCreated={() => setReloadKey((k) => k + 1)} />

      <GlassCard variant="panel" padded={false}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) 160px 130px 130px', gap: 14, padding: '9px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <span>Period</span>
          <span>Status</span>
          <span>Created</span>
          <span />
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Loader2 size={14} className="sos-spin" /> Loading…
          </div>
        ) : error ? (
          <div style={{ padding: 24, color: 'var(--sos-status-danger)' }}>Failed to load reports: {error}</div>
        ) : reports.length === 0 ? (
          <div style={{ padding: 8 }}>
            <EmptyState
              Icon={FileText}
              title="No work reports yet"
              description="Compile one above — pick a date range and the system assembles the log."
            />
          </div>
        ) : (
          reports.map((r) => (
            <Link
              key={r.id}
              href={`/jr/reports/${r.id}` as Route}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) 160px 130px 130px', gap: 14, padding: '13px 16px', alignItems: 'center', borderBottom: '1px solid var(--sos-border-subtle)', textDecoration: 'none', transition: 'background 150ms' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                {jrFmtDate(r.periodFrom)} — {jrFmtDate(r.periodTo)}
              </span>
              <span>
                <StatusBadge tone={workReportStatusTone(r.status)} size="sm">
                  {r.status === 'FINALIZED' ? 'Finalized' : 'Draft'}
                </StatusBadge>
              </span>
              <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{jrFmtDate(r.createdAt)}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sos-brand-primary-strong)', textAlign: 'right' }}>
                Open →
              </span>
            </Link>
          ))
        )}
      </GlassCard>
    </div>
  );
}
