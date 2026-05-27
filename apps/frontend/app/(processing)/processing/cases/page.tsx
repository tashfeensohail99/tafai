'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { STAGE_LABEL, PRIORITY_LABEL, fmtRelative } from '@/components/processing/mockData';
import { stageTone, priorityTone } from '@/components/processing/ProcessingDashboardPage';
import { StatusBadge, GlassCard } from '@/components/sales-v2/ui';
import {
  fetchProcessingCases,
  casePersonName,
  type ApiProcessingCaseListItem,
} from '@/lib/processing';
import { labelForServiceCode } from '@/lib/service-types';

/**
 * Active processing cases — all stages except COMPLETED and CANCELLED.
 *
 * Was rendering MOCK_PROCESSING_CASES; now hits `GET /processing/cases` with
 * a generous limit so the working set fits in one page (cases list rarely
 * grows past a few hundred during normal operations).
 */
export default function CasesPage() {
  const [cases, setCases] = useState<ApiProcessingCaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProcessingCases({ limit: 200 })
      .then((res) => {
        if (cancelled) return;
        // Filter out finished / cancelled for the active list view.
        setCases(
          res.cases.filter((c) => c.stage !== 'COMPLETED' && c.stage !== 'CANCELLED'),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load cases');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', gap: 10, color: 'var(--sos-text-muted)' }}>
        <Loader2 size={18} className="sos-spin" />
        <span>Loading cases…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 24, color: 'var(--sos-status-danger)' }}>
        Failed to load cases: {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>All active cases ({cases.length})</div>
      <GlassCard variant="panel" padded={false}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: '12px', padding: '9px 14px', fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <span>Client / Service</span>
          <span>Stage</span>
          <span>Priority</span>
          <span>Officer</span>
          <span>Created</span>
          <span></span>
        </div>
        {cases.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
            No active processing cases yet. Cases appear here once Finance hands them off.
          </div>
        ) : (
          cases.map((c) => (
          <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: '12px', padding: '12px 14px', alignItems: 'center', borderBottom: '1px solid var(--sos-border-subtle)', transition: 'background 150ms' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{casePersonName(c)}</div>
              <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{labelForServiceCode(c.service)} · {c.targetCountry}</div>
            </div>
            <StatusBadge tone={stageTone(c.stage)} size="sm">{STAGE_LABEL[c.stage]}</StatusBadge>
            <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>{PRIORITY_LABEL[c.priority]}</StatusBadge>
            <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)' }}>{c.assignedOfficer?.email.split('@')[0] ?? <span style={{ color: 'var(--sos-status-warning)' }}>Unassigned</span>}</div>
            <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{fmtRelative(c.createdAt)}</div>
            <Link href={`/processing/cases/${c.id}` as Route} style={{ fontSize: '13px', fontWeight: 500, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}>
              Open →
            </Link>
          </div>
          ))
        )}
      </GlassCard>
    </div>
  );
}
