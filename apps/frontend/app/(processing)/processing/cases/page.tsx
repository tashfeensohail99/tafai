'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { MOCK_PROCESSING_CASES, STAGE_LABEL, PRIORITY_LABEL, fmtRelative } from '@/components/processing/mockData';
import { stageTone, priorityTone } from '@/components/processing/ProcessingDashboardPage';
import { StatusBadge, GlassCard } from '@/components/sales-v2/ui';

export default function CasesPage() {
  const active = MOCK_PROCESSING_CASES.filter((c) => c.stage !== 'COMPLETED' && c.stage !== 'CANCELLED');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>All active cases ({active.length})</div>
      <GlassCard variant="panel" padded={false}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: '12px', padding: '9px 14px', fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <span>Client / Service</span>
          <span>Stage</span>
          <span>Priority</span>
          <span>Officer</span>
          <span>Created</span>
          <span></span>
        </div>
        {active.map((c) => (
          <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: '12px', padding: '12px 14px', alignItems: 'center', borderBottom: '1px solid var(--sos-border-subtle)', transition: 'background 150ms' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{c.clientName}</div>
              <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{c.service} · {c.targetCountry}</div>
            </div>
            <StatusBadge tone={stageTone(c.stage)} size="sm">{STAGE_LABEL[c.stage]}</StatusBadge>
            <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>{PRIORITY_LABEL[c.priority]}</StatusBadge>
            <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)' }}>{c.assignedOfficer?.name.split(' ')[0] ?? <span style={{ color: 'var(--sos-status-warning)' }}>Unassigned</span>}</div>
            <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{fmtRelative(c.createdAt)}</div>
            <Link href={`/processing/cases/${c.id}` as Route} style={{ fontSize: '13px', fontWeight: 500, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}>
              Open →
            </Link>
          </div>
        ))}
      </GlassCard>
    </div>
  );
}
