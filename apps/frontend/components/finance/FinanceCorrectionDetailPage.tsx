'use client';
// Finance Correction Detail — Screen 5b of 7.
// Shows a single REJECTED handover. Finance officer can add notes and re-open it.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import {
  ActionBar,
  FormTextarea,
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  fetchHandoverById,
  reviewHandover,
  fmtAmount,
  fmtDateTime,
  clientName,
  METHOD_LABEL,
  type ApiHandover,
} from '@/lib/finance-api';

// ---------- ReadOnly row helper -----------------------------------------

function ReadOnlyRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--sos-space-4)', padding: 'var(--sos-space-2) 0', borderBottom: '1px solid var(--sos-border)' }}>
      <span style={{ minWidth: 160, fontSize: 'var(--sos-text-sm)', color: 'var(--sos-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 'var(--sos-text-sm)', color: 'var(--sos-text)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

// ---------- Main component -----------------------------------------------

interface Props {
  paymentId: string;
}

export function FinanceCorrectionDetailPage({ paymentId }: Props) {
  const [handover, setHandover] = useState<ApiHandover | null>(null);
  const [loading, setLoading] = useState(true);
  const [financeNotes, setFinanceNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [reopened, setReopened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchHandoverById(paymentId)
      .then((h) => { setHandover(h); setFinanceNotes(h.financeNotes ?? ''); })
      .catch(() => setError('Could not load handover.'))
      .finally(() => setLoading(false));
  }, [paymentId]);

  async function handleReopen() {
    if (!handover) return;
    setSaving(true);
    try {
      await reviewHandover(handover.id, 'MARK_IN_REVIEW', { financeNotes });
      setReopened(true);
    } catch {
      setError('Failed to re-open handover. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 'var(--sos-space-8)', textAlign: 'center', color: 'var(--sos-muted)' }}>
        Loading correction…
      </div>
    );
  }

  if (error || !handover) {
    return (
      <div style={{ padding: 'var(--sos-space-8)', textAlign: 'center', color: 'var(--sos-danger)' }}>
        {error ?? 'Handover not found.'}
      </div>
    );
  }

  const name = clientName(handover);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-6)', maxWidth: 860, margin: '0 auto' }}>
      <PageHeader
        eyebrow={
          <Link href={'/finance/corrections' as Route} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--sos-muted)', textDecoration: 'none', fontSize: 'var(--sos-text-sm)' }}>
            <ArrowLeft size={14} /> Corrections
          </Link>
        }
        title={name}
        description={`Rejection detail · Handover #${handover.id.slice(-8).toUpperCase()}`}
        badge={<StatusBadge tone="danger">Correction Required</StatusBadge>}
      />

      {/* Handover details */}
      <GlassCard>
        <div style={{ padding: 'var(--sos-space-5)' }}>
          <p style={{ fontSize: 'var(--sos-text-xs)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--sos-muted)', marginBottom: 'var(--sos-space-3)' }}>
            Payment Details
          </p>
          <ReadOnlyRow label="Client" value={name} />
          <ReadOnlyRow label="Service" value={handover.lead.serviceInterest ?? '—'} />
          <ReadOnlyRow label="Target Country" value={handover.lead.targetCountry ?? '—'} />
          <ReadOnlyRow label="Amount" value={fmtAmount(handover.submittedAmount, handover.currency)} />
          <ReadOnlyRow label="Method" value={METHOD_LABEL[handover.paymentMethod as keyof typeof METHOD_LABEL] ?? handover.paymentMethod} />
          <ReadOnlyRow label="Reference" value={handover.transactionRef ?? '—'} />
          <ReadOnlyRow label="Submitted" value={fmtDateTime(handover.submittedAt)} />
          {handover.notes && <ReadOnlyRow label="Sales Notes" value={handover.notes} />}
        </div>
      </GlassCard>

      {/* Finance notes / correction reason */}
      <GlassCard>
        <div style={{ padding: 'var(--sos-space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-4)' }}>
          <p style={{ fontSize: 'var(--sos-text-xs)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--sos-muted)' }}>
            Finance Notes (Correction Reason)
          </p>
          {reopened ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sos-success)', fontSize: 'var(--sos-text-sm)' }}>
              <CheckCircle2 size={16} />
              Handover re-opened for verification. Sales will be notified.
            </div>
          ) : (
            <>
              <FormTextarea
                label="Notes for Sales"
                value={financeNotes}
                onChange={(e) => setFinanceNotes(e.target.value)}
                placeholder="Describe what needs to be corrected by Sales…"
                rows={4}
              />
              <ActionBar
                left={
                  <SecondaryButton onClick={() => window.history.back()}>
                    Cancel
                  </SecondaryButton>
                }
                right={
                  <PrimaryButton onClick={handleReopen} disabled={saving || !financeNotes.trim()}>
                    {saving ? 'Saving…' : 'Re-open for Verification'}
                  </PrimaryButton>
                }
              />
            </>
          )}
        </div>
      </GlassCard>
    </div>
  );
}