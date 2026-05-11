'use client';
// Document Checklist Tab — Phase 1B.
// Shows all document items with criticality chips, status badges, actions.
// Officers can click "Review" to open the review panel inline.

import { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  EmptyState,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  type MockDocumentItem,
  type DocumentCriticality,
  type DocumentItemStatus,
  DOC_STATUS_LABEL,
  getDocumentProgress,
  fmtDate,
} from '@/components/processing/mockData';
import { DocumentReviewPanel } from '../DocumentReviewPanel';

// ---------- Tone helpers --------------------------------------------------

function docStatusTone(status: DocumentItemStatus): BadgeTone {
  switch (status) {
    case 'NOT_SUBMITTED': return 'neutral';
    case 'SUBMITTED': return 'info';
    case 'UNDER_REVIEW': return 'accent';
    case 'ACCEPTED': return 'success';
    case 'REJECTED': return 'danger';
    case 'EXPIRED': return 'danger';
    case 'EXPIRING_SOON': return 'warning';
    case 'WAIVED': return 'neutral';
    case 'NOT_APPLICABLE': return 'neutral';
    default: return 'neutral';
  }
}

function criticalityIcon(criticality: DocumentCriticality) {
  switch (criticality) {
    case 'CRITICAL': return <ShieldAlert size={13} style={{ color: 'var(--sos-status-danger)' }} />;
    case 'REQUIRED': return <ShieldCheck size={13} style={{ color: 'var(--sos-status-warning)' }} />;
    case 'CONDITIONAL': return <Shield size={13} style={{ color: 'var(--sos-status-info)' }} />;
    default: return <Shield size={13} style={{ color: 'var(--sos-text-muted)' }} />;
  }
}

function criticalityLabel(criticality: DocumentCriticality): string {
  switch (criticality) {
    case 'CRITICAL': return 'Critical';
    case 'REQUIRED': return 'Required';
    case 'CONDITIONAL': return 'Conditional';
    case 'SUPPORTING': return 'Supporting';
    case 'OPTIONAL': return 'Optional';
    default: return criticality;
  }
}

function criticalityTone(criticality: DocumentCriticality): BadgeTone {
  switch (criticality) {
    case 'CRITICAL': return 'danger';
    case 'REQUIRED': return 'warning';
    case 'CONDITIONAL': return 'info';
    case 'SUPPORTING': return 'neutral';
    case 'OPTIONAL': return 'neutral';
    default: return 'neutral';
  }
}

// ---------- Single checklist row -----------------------------------------

interface ChecklistRowProps {
  item: MockDocumentItem;
  onReview: (item: MockDocumentItem) => void;
  onReopen: (item: MockDocumentItem) => void;
}

function ChecklistRow({ item, onReview, onReopen }: ChecklistRowProps) {
  const hasFile = item.status !== 'NOT_SUBMITTED';
  const isExpiringSoon = item.validityExpiryDate
    ? new Date(item.validityExpiryDate) < new Date('2026-08-01')
    : false;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '24px 1fr auto',
        gap: '10px',
        padding: '12px 14px',
        borderRadius: 'var(--sos-radius-md)',
        alignItems: 'flex-start',
        transition: 'background 150ms',
        borderBottom: '1px solid var(--sos-border-subtle)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Status icon */}
      <div style={{ paddingTop: '2px' }}>
        {item.status === 'ACCEPTED' ? (
          <CheckCircle2 size={16} style={{ color: 'var(--sos-status-success)' }} />
        ) : item.status === 'REJECTED' ? (
          <XCircle size={16} style={{ color: 'var(--sos-status-danger)' }} />
        ) : item.status === 'UNDER_REVIEW' || item.status === 'SUBMITTED' ? (
          <Clock size={16} style={{ color: 'var(--sos-status-info)' }} />
        ) : item.status === 'WAIVED' ? (
          <CheckCircle2 size={16} style={{ color: 'var(--sos-text-muted)' }} />
        ) : (
          <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid var(--sos-border-subtle)' }} />
        )}
      </div>

      {/* Main content */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '3px' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
            {item.documentName}
          </span>
          <StatusBadge tone={criticalityTone(item.criticality)} size="sm" dot={false} icon={criticalityIcon(item.criticality)}>
            {criticalityLabel(item.criticality)}
          </StatusBadge>
        </div>

        <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginBottom: '5px' }}>
          {item.description}
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusBadge tone={docStatusTone(item.status)} size="sm">{DOC_STATUS_LABEL[item.status]}</StatusBadge>

          {item.expectedFormats.length > 0 ? (
            <span style={{ fontSize: '11px', color: 'var(--sos-text-muted)' }}>
              {item.expectedFormats.join(' / ')}
            </span>
          ) : null}

          {item.validityExpiryDate ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: isExpiringSoon ? 'var(--sos-status-warning)' : 'var(--sos-text-muted)' }}>
              <Calendar size={11} /> Expires {fmtDate(item.validityExpiryDate)}
            </span>
          ) : null}

          {item.versionNumber && item.versionNumber > 1 ? (
            <span style={{ fontSize: '11px', color: 'var(--sos-text-muted)' }}>v{item.versionNumber}</span>
          ) : null}
        </div>

        {item.status === 'REJECTED' && item.rejectionNote ? (
          <div style={{ marginTop: '6px', padding: '6px 10px', borderRadius: 'var(--sos-radius-sm)', background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', fontSize: '12px', color: 'var(--sos-status-danger)' }}>
            Rejection: {item.rejectionNote}
          </div>
        ) : null}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end', paddingTop: '2px' }}>
        {(item.status === 'SUBMITTED' || item.status === 'UNDER_REVIEW') ? (
          <PrimaryButton size="sm" onClick={() => onReview(item)} iconLeft={<Eye size={13} />}>
            Review
          </PrimaryButton>
        ) : item.status === 'ACCEPTED' ? (
          <SecondaryButton size="sm" onClick={() => onReview(item)} iconLeft={<Eye size={13} />}>
            View
          </SecondaryButton>
        ) : (item.status === 'REJECTED' || item.status === 'EXPIRED') ? (
          <>
            <SecondaryButton size="sm" onClick={() => onReview(item)} iconLeft={<Eye size={13} />}>
              View
            </SecondaryButton>
            <SecondaryButton size="sm" onClick={() => onReopen(item)} iconLeft={<RotateCcw size={13} />}>
              Re-open
            </SecondaryButton>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Document checklist tab ----------------------------------------

export function DocumentChecklistTab({ c }: { c: MockProcessingCase }) {
  const [reviewItem, setReviewItem] = useState<MockDocumentItem | null>(null);
  // Tracks items that have been optimistically re-opened (status reset to NOT_SUBMITTED in UI).
  const [reopenedIds, setReopenedIds] = useState<Set<string>>(new Set());

  function handleReopen(item: MockDocumentItem) {
    // Mock: PATCH /processing/cases/:caseId/documents/:itemId/reopen
    setReopenedIds((prev) => new Set([...prev, item.id]));
  }

  // Apply optimistic re-open override
  const displayItems = c.documentItems.map((item) =>
    reopenedIds.has(item.id) ? { ...item, status: 'NOT_SUBMITTED' as const } : item,
  );

  if (reviewItem) {
    return <DocumentReviewPanel item={reviewItem} caseId={c.id} onBack={() => setReviewItem(null)} />;
  }

  const progress = getDocumentProgress(displayItems);
  const docPct = progress.total > 0 ? Math.round((progress.accepted / progress.total) * 100) : 0;

  const critical  = displayItems.filter((i) => i.criticality === 'CRITICAL');
  const required  = displayItems.filter((i) => i.criticality === 'REQUIRED');
  const supporting = displayItems.filter((i) => i.criticality === 'CONDITIONAL' || i.criticality === 'SUPPORTING' || i.criticality === 'OPTIONAL');

  if (displayItems.length === 0) {
    return (
      <GlassCard variant="panel" padded="lg">
        <EmptyState
          Icon={FileText}
          title="No documents yet"
          description="Document checklist will be created when this case is acknowledged."
        />
      </GlassCard>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Progress bar */}
      <GlassCard variant="soft" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
              <span style={{ fontWeight: 600, color: 'var(--sos-text-primary)' }}>Critical + required documents</span>
              <span style={{ color: 'var(--sos-text-muted)' }}>{progress.accepted}/{progress.total}</span>
            </div>
            <div style={{ height: '8px', background: 'var(--sos-surface-hover)', borderRadius: '999px', overflow: 'hidden' }}>
              <div style={{ width: `${docPct}%`, height: '100%', background: docPct === 100 ? 'var(--sos-status-success)' : 'var(--sos-brand-gradient)', borderRadius: '999px', transition: 'width 400ms ease' }} />
            </div>
          </div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: docPct === 100 ? 'var(--sos-status-success)' : 'var(--sos-text-primary)', letterSpacing: '-0.02em' }}>
            {docPct}%
          </div>
        </div>
        {progress.rejected > 0 ? (
          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--sos-status-danger)' }}>
            <AlertTriangle size={13} /> {progress.rejected} document{progress.rejected !== 1 ? 's' : ''} rejected — client must reupload
          </div>
        ) : null}
      </GlassCard>

      {/* Critical section */}
      {critical.length > 0 ? (
        <GlassCard variant="panel" padded={false}>
          <div style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 600, color: 'var(--sos-status-danger)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
            <ShieldAlert size={13} /> Critical documents ({critical.length})
          </div>
          {critical.map((item) => (
            <ChecklistRow key={item.id} item={item} onReview={setReviewItem} onReopen={handleReopen} />
          ))}
        </GlassCard>
      ) : null}

      {/* Required section */}
      {required.length > 0 ? (
        <GlassCard variant="panel" padded={false}>
          <div style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 600, color: 'var(--sos-status-warning)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
            <ShieldCheck size={13} /> Required documents ({required.length})
          </div>
          {required.map((item) => (
            <ChecklistRow key={item.id} item={item} onReview={setReviewItem} onReopen={handleReopen} />
          ))}
        </GlassCard>
      ) : null}

      {/* Supporting section */}
      {supporting.length > 0 ? (
        <GlassCard variant="panel" padded={false}>
          <div style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
            Supporting / optional ({supporting.length})
          </div>
          {supporting.map((item) => (
            <ChecklistRow key={item.id} item={item} onReview={setReviewItem} onReopen={handleReopen} />
          ))}
        </GlassCard>
      ) : null}
    </div>
  );
}
