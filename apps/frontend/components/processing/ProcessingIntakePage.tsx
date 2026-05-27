'use client';
// Processing Intake Queue — Phase 1B / Screen 2.
// Shows all INTAKE_PENDING cases sorted by priority.
// Officer can acknowledge & assign a case directly from this screen.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Globe,
  Inbox,
  Loader2,
  Phone,
  User,
  Wallet,
  X,
} from 'lucide-react';
import {
  ButtonLink,
  EmptyState,
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  fmtAmount,
  fmtRelative,
  PRIORITY_LABEL,
} from '@/components/processing/mockData';
import { stageTone, priorityTone } from './ProcessingDashboardPage';
import {
  fetchIntakeQueue,
  acknowledgeIntake,
  casePersonName,
  casePersonPhone,
  type ApiIntakeCaseItem,
} from '@/lib/processing';
import { labelForServiceCode } from '@/lib/service-types';

// ---------- Acknowledge modal ----------------------------------------------

interface AcknowledgeModalProps {
  caseRecord: ApiIntakeCaseItem;
  onClose: () => void;
  onConfirm: () => void;
}

function AcknowledgeModal({ caseRecord: c, onClose, onConfirm }: AcknowledgeModalProps) {
  // Acknowledge claims the case for the current user (the API defaults to
  // user.id when no `assignOfficerId` is passed). A future enhancement
  // could let manager-permission users re-assign to another officer at
  // this step; for now the simplest flow is "I'll take it".
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      await acknowledgeIntake(c.id);
      onConfirm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to acknowledge');
      setLoading(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="sos-glass sos-glass--strong"
        style={{ width: '100%', maxWidth: '460px', padding: '28px', borderRadius: 'var(--sos-radius-lg)', position: 'relative' }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: 'var(--sos-text-muted)', cursor: 'pointer', padding: '6px' }}
        >
          <X size={16} />
        </button>

        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-brand-primary-strong)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Acknowledge Intake</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>{casePersonName(c)}</div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginTop: '4px' }}>{labelForServiceCode(c.service)} · {c.targetCountry}</div>
        </div>

        {/* Case summary */}
        <div className="sos-glass" style={{ padding: '14px 16px', borderRadius: 'var(--sos-radius-md)', marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px' }}>
          <div>
            <div style={{ color: 'var(--sos-text-muted)', fontSize: '11px', marginBottom: '2px' }}>Priority</div>
            <StatusBadge tone={priorityTone(c.priority)} size="sm">{PRIORITY_LABEL[c.priority]}</StatusBadge>
          </div>
          <div>
            <div style={{ color: 'var(--sos-text-muted)', fontSize: '11px', marginBottom: '2px' }}>Amount paid</div>
            <div style={{ fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              {c.financeHandover
                ? fmtAmount(Number(c.financeHandover.submittedAmount), c.financeHandover.currency)
                : '—'}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--sos-text-muted)', fontSize: '11px', marginBottom: '2px' }}>Receipt file</div>
            <div style={{ fontWeight: 500, color: 'var(--sos-text-primary)', fontSize: 12 }}>
              {c.financeHandover?.receiptFileName ?? '—'}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--sos-text-muted)', fontSize: '11px', marginBottom: '2px' }}>Received</div>
            <div style={{ fontWeight: 500, color: 'var(--sos-text-primary)' }}>{fmtRelative(c.createdAt)}</div>
          </div>
        </div>

        {c.financeHandoverNote ? (
          <div style={{ padding: '12px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-info-soft)', border: '1px solid var(--sos-status-info-border)', fontSize: '13px', color: 'var(--sos-text-primary)', marginBottom: '20px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-status-info)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Finance note</div>
            {c.financeHandoverNote}
          </div>
        ) : null}

        {/* Claim notice — the API auto-assigns to the current user when no
            officerId is passed. Manager-level re-assignment can happen
            later from the case workspace. */}
        <div style={{ marginBottom: 20, fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
          Acknowledging will assign this case to you and move it to <strong>Documents Collection</strong>. The doc checklist for <strong>{labelForServiceCode(c.service)} → {c.targetCountry}</strong> will be auto-attached from the matching template.
        </div>
        {error ? (
          <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <SecondaryButton onClick={onClose} disabled={loading}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={handleConfirm}
            disabled={loading}
            iconLeft={<CheckCircle2 size={15} />}
          >
            {loading ? 'Acknowledging…' : 'Acknowledge & assign'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ---------- Intake queue page ----------------------------------------------

export function ProcessingIntakePage() {
  const [queue, setQueue] = useState<ApiIntakeCaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<ApiIntakeCaseItem | null>(null);
  const [acknowledgedCount, setAcknowledgedCount] = useState(0);

  function load() {
    setLoading(true);
    fetchIntakeQueue()
      .then(setQueue)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load queue'))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  function handleAcknowledge(caseRecord: ApiIntakeCaseItem) {
    setActiveModal(caseRecord);
  }

  function handleConfirm() {
    setActiveModal(null);
    setAcknowledgedCount((n) => n + 1);
    load(); // re-fetch so the acknowledged case drops off the list
  }

  return (
    <>
      {activeModal ? (
        <AcknowledgeModal
          caseRecord={activeModal}
          onClose={() => setActiveModal(null)}
          onConfirm={handleConfirm}
        />
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Hero header */}
        <PageHeader
          eyebrow="Processing"
          title="Intake Queue"
          description={
            queue.length > 0
              ? `${queue.length} case${queue.length !== 1 ? 's' : ''} awaiting acknowledgment. Sorted by priority.`
              : 'Intake queue is clear. All cases have been acknowledged.'
          }
          actions={
            <ButtonLink href={'/processing' as Route} variant="ghost" iconRight={<ArrowRight size={14} />}>
              Back to dashboard
            </ButtonLink>
          }
        />

        {/* Empty / loading / error states */}
        {loading ? (
          <GlassCard variant="panel" padded="lg">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
              <Loader2 size={16} className="sos-spin" />
              <span>Loading intake queue…</span>
            </div>
          </GlassCard>
        ) : error ? (
          <GlassCard variant="panel" padded="lg">
            <div style={{ padding: 16, color: 'var(--sos-status-danger)' }}>Failed to load: {error}</div>
          </GlassCard>
        ) : queue.length === 0 ? (
          <GlassCard variant="panel" padded="lg">
            <EmptyState
              Icon={CheckCircle2}
              title="Queue is clear"
              description="All new cases from Finance have been acknowledged. Check back later."
            />
          </GlassCard>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {queue.map((c) => (
              <GlassCard
                key={c.id}
                variant="default"
                hover
                padded="md"
                style={{ borderLeft: c.priority === 'CRITICAL' ? '3px solid var(--sos-status-danger)' : c.priority === 'URGENT' ? '3px solid var(--sos-status-warning)' : undefined }}
              >
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  {/* Priority chip */}
                  <div style={{ flexShrink: 0, paddingTop: '2px' }}>
                    <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>
                      {PRIORITY_LABEL[c.priority]}
                    </StatusBadge>
                  </div>

                  {/* Main content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Row 1: client + service */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sos-text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <User size={14} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
                        {casePersonName(c)}
                      </div>
                      <div style={{ height: '16px', width: '1px', background: 'var(--sos-border-subtle)' }} />
                      <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Globe size={13} />
                        {labelForServiceCode(c.service)} · {c.targetCountry}
                      </div>
                    </div>

                    {/* Row 2: meta chips */}
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12.5px', color: 'var(--sos-text-muted)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Phone size={12} /> {casePersonPhone(c)}
                      </span>
                      {c.financeHandover ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <Wallet size={12} /> {fmtAmount(Number(c.financeHandover.submittedAmount), c.financeHandover.currency)}
                        </span>
                      ) : null}
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <CalendarClock size={12} /> Received {fmtRelative(c.createdAt)}
                      </span>
                    </div>

                    {/* Finance note */}
                    {c.financeHandoverNote ? (
                      <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: 'var(--sos-radius-sm)', background: 'var(--sos-status-info-soft)', border: '1px solid var(--sos-status-info-border)', fontSize: '12.5px', color: 'var(--sos-text-primary)' }}>
                        <span style={{ fontWeight: 600, color: 'var(--sos-status-info)' }}>Note: </span>
                        {c.financeHandoverNote}
                      </div>
                    ) : null}
                  </div>

                  {/* Actions */}
                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                    <PrimaryButton
                      onClick={() => handleAcknowledge(c)}
                      iconLeft={<CheckCircle2 size={14} />}
                    >
                      Acknowledge
                    </PrimaryButton>
                    <Link
                      href={`/processing/cases/${c.id}` as Route}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--sos-text-muted)', textDecoration: 'none' }}
                    >
                      Preview <ArrowRight size={12} />
                    </Link>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}

        {/* Already acknowledged this session */}
        {acknowledgedCount > 0 ? (
          <GlassCard variant="soft" padded="md">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--sos-status-success)' }}>
              <CheckCircle2 size={16} />
              <span style={{ fontWeight: 600 }}>{acknowledgedCount}</span> case{acknowledgedCount !== 1 ? 's' : ''} acknowledged this session. Find them in{' '}
              <Link href={'/processing/cases' as Route} style={{ color: 'var(--sos-brand-primary-strong)', fontWeight: 600, textDecoration: 'none' }}>
                My Cases <ArrowRight size={13} style={{ display: 'inline', verticalAlign: 'middle' }} />
              </Link>
            </div>
          </GlassCard>
        ) : null}
      </div>
    </>
  );
}
