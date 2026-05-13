'use client';
// Finance Corrections â€” Screen 5a of 7.
// Lists REJECTED handovers (sent back for correction).

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  PageHeader,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  fetchHandovers,
  fmtRelative,
  fmtAmount,
  clientName,
  type ApiHandover,
} from '@/lib/finance-api';

// ---------- Row component ------------------------------------------------

function CorrectionRow({ handover }: { handover: ApiHandover }) {
  return (
    <Link
      href={`/finance/corrections/${handover.id}` as Route}
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <div
        style={{
          background: 'var(--sos-surface)',
          border: '1px solid var(--sos-border)',
          borderRadius: 'var(--sos-radius-md)',
          padding: 'var(--sos-space-4)',
          cursor: 'pointer',
          transition: 'border-color 0.15s, background 0.15s',
          display: 'flex',
          gap: 'var(--sos-space-4)',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sos-space-2)', marginBottom: 4 }}>
            <span style={{ fontSize: 'var(--sos-text-sm)', fontWeight: 600, color: 'var(--sos-text)' }}>
              {clientName(handover)}
            </span>
            <StatusBadge tone="danger" size="sm">Rejected</StatusBadge>
          </div>
          <div style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', marginBottom: 4 }}>
            {handover.lead.serviceInterest ?? 'â€”'} Â· {handover.lead.targetCountry ?? 'â€”'} Â·{' '}
            {fmtAmount(handover.submittedAmount, handover.currency)}
          </div>
          {handover.financeNotes && (
            <div style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
              "{handover.financeNotes.slice(0, 80)}{handover.financeNotes.length > 80 ? 'â€¦' : ''}"
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0, fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', textAlign: 'right' }}>
          {fmtRelative(handover.updatedAt)}
        </div>
      </div>
    </Link>
  );
}

// ---------- Main page component ------------------------------------------

export function FinanceCorrectionsPage() {
  const [rejected, setRejected] = useState<ApiHandover[]>([]);

  useEffect(() => {
    fetchHandovers({ status: 'REJECTED' }).then(setRejected).catch(console.error);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sos-space-6)',
        maxWidth: 900,
        margin: '0 auto',
      }}
    >
      <PageHeader
        eyebrow="Finance"
        title="Corrections"
        description="Cases rejected â€” awaiting resubmission from Sales"
      />

      <GlassCard>
        <div style={{ padding: 'var(--sos-space-3) var(--sos-space-5)', display: 'flex', alignItems: 'center', gap: 'var(--sos-space-2)' }}>
          <span style={{ fontSize: 'var(--sos-text-2xl)', fontWeight: 700, color: 'var(--sos-text)' }}>
            {rejected.length}
          </span>
          <StatusBadge tone="danger">Correction Required</StatusBadge>
        </div>
      </GlassCard>

      {rejected.length === 0 ? (
        <EmptyState
          Icon={MessageSquare}
          title="No active corrections"
          description="All corrections have been resolved. New ones will appear here when Finance rejects a handover."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-3)' }}>
          {rejected.map((h) => (
            <CorrectionRow key={h.id} handover={h} />
          ))}
        </div>
      )}
    </div>
  );
}
