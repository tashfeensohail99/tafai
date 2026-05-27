'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { STAGE_LABEL, PRIORITY_LABEL, fmtRelative } from '@/components/processing/mockData';
import { stageTone, priorityTone } from '@/components/processing/ProcessingDashboardPage';
import { StatusBadge, GlassCard } from '@/components/sales-v2/ui';
import {
  fetchProcessingCases,
  casePersonName,
  type ApiProcessingCaseListItem,
  type ProcessingStage,
  type ProcessingPriority,
  type ListCasesQuery,
} from '@/lib/processing';
import { SERVICE_TYPES, labelForServiceCode } from '@/lib/service-types';

/**
 * Active processing cases — all stages except COMPLETED and CANCELLED.
 * Workflow doc asked for "as many filters as possible: duration, case type,
 * processing officer, last activity" — all wired here. Each filter change
 * re-fetches with debounced search.
 */

const STAGES: ProcessingStage[] = [
  'INTAKE_PENDING',
  'DOCUMENTS_COLLECTION',
  'DOCUMENTS_UNDER_REVIEW',
  'DOCUMENTS_INCOMPLETE',
  'DOCUMENTS_COMPLETE',
  'READY_FOR_SUBMISSION',
  'SUBMITTED',
  'UNDER_AUTHORITY_REVIEW',
  'ADDITIONAL_INFO_REQUESTED',
  'DECISION_RECEIVED',
  'APPROVED',
  'REJECTED',
  'APPEAL_IN_PROGRESS',
];

const PRIORITIES: ProcessingPriority[] = ['CRITICAL', 'URGENT', 'NORMAL', 'LOW'];

export default function CasesPage() {
  const [cases, setCases] = useState<ApiProcessingCaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [stage, setStage] = useState<ProcessingStage | ''>('');
  const [priority, setPriority] = useState<ProcessingPriority | ''>('');
  const [service, setService] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [updatedFrom, setUpdatedFrom] = useState('');
  const [updatedTo, setUpdatedTo] = useState('');

  // Debounce search so typing doesn't burst requests.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const query: ListCasesQuery = useMemo(
    () => ({
      limit: 200,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(stage ? { stage } : {}),
      ...(priority ? { priority } : {}),
      ...(service ? { service } : {}),
      ...(createdFrom ? { createdFrom } : {}),
      ...(createdTo ? { createdTo } : {}),
      ...(updatedFrom ? { updatedFrom } : {}),
      ...(updatedTo ? { updatedTo } : {}),
    }),
    [debouncedSearch, stage, priority, service, createdFrom, createdTo, updatedFrom, updatedTo],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProcessingCases(query)
      .then((res) => {
        if (cancelled) return;
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
  }, [query]);

  const hasActiveFilters = !!(stage || priority || service || createdFrom || createdTo || updatedFrom || updatedTo || debouncedSearch);

  function clearAll() {
    setSearch('');
    setStage('');
    setPriority('');
    setService('');
    setCreatedFrom('');
    setCreatedTo('');
    setUpdatedFrom('');
    setUpdatedTo('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Filter row */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Search bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)' }}>
            <Search size={14} style={{ color: 'var(--sos-text-muted)' }} />
            <input
              type="search"
              placeholder="Search by client name or case id…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--sos-text-primary)', fontSize: 13.5 }}
            />
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearAll}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: '1px solid var(--sos-border-subtle)', borderRadius: 6, background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 11.5, cursor: 'pointer' }}
              >
                <X size={11} /> Clear filters
              </button>
            ) : null}
          </div>

          {/* Filter pills */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            <select
              className="sos-input"
              value={stage}
              onChange={(e) => setStage(e.target.value as ProcessingStage | '')}
            >
              <option value="">All stages</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>{STAGE_LABEL[s]}</option>
              ))}
            </select>

            <select
              className="sos-input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as ProcessingPriority | '')}
            >
              <option value="">All priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>

            <select
              className="sos-input"
              value={service}
              onChange={(e) => setService(e.target.value)}
            >
              <option value="">All service types</option>
              {SERVICE_TYPES.map((s) => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Date ranges (duration + last activity per workflow doc) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Intake date</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="sos-input" type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} placeholder="From" />
                <input className="sos-input" type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} placeholder="To" />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Last activity</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="sos-input" type="date" value={updatedFrom} onChange={(e) => setUpdatedFrom(e.target.value)} placeholder="From" />
                <input className="sos-input" type="date" value={updatedTo} onChange={(e) => setUpdatedTo(e.target.value)} placeholder="To" />
              </div>
            </div>
          </div>
        </div>
      </GlassCard>

      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
        Active cases ({cases.length}){hasActiveFilters ? ' · filtered' : ''}
      </div>

      <GlassCard variant="panel" padded={false}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: '12px', padding: '9px 14px', fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <span>Client / Service</span>
          <span>Stage</span>
          <span>Priority</span>
          <span>Officer</span>
          <span>Last activity</span>
          <span></span>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Loader2 size={14} className="sos-spin" /> Loading…
          </div>
        ) : error ? (
          <div style={{ padding: 24, color: 'var(--sos-status-danger)' }}>Failed to load cases: {error}</div>
        ) : cases.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
            {hasActiveFilters ? 'No cases match these filters.' : 'No active processing cases yet. Cases appear here once Finance hands them off.'}
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
              <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{fmtRelative(c.updatedAt)}</div>
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
