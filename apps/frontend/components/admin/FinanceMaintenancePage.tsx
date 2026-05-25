'use client';

/**
 * Admin → Settings → Finance maintenance.
 *
 * Right now this page hosts a single dangerous-but-safe action: a
 * retroactive cleanup of Invoice/Payment rows that were left orphaned
 * by old "Verify then Reject" flows on a finance handover. The REJECT
 * branch of the service now auto-voids those rows going forward, but
 * data created before that fix still lingers in the database and
 * pollutes lead aggregates (a $1000 rejected attempt was being summed
 * alongside a $1500 corrected resubmission, producing a phantom
 * $2500 in the lead's totals).
 *
 * The flow is intentionally two-step:
 *   1. Operator clicks "Run cleanup" → opens a modal demanding a
 *      reason (audit + timeline trail get the operator's "why").
 *   2. Operator types a reason + confirms → backend scans every
 *      rejected handover, voids only Payment.PENDING + Invoice.DRAFT/SENT
 *      rows (paid money is never touched), and writes one AuditLog
 *      + one Lead-timeline event per voided row. We then surface the
 *      counts on this page so the admin sees exactly what changed.
 *
 * Built to be additive — if more finance maintenance jobs need a UI
 * later (refund batch reversals, invoice number resets, etc.) they
 * slot in as additional cards on this page.
 */

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Lock,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import {
  Field,
  FormInput,
  FormTextarea,
  GhostButton,
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import { Modal } from '@/components/whatsapp/Modal';
import {
  cleanupOrphanHandovers,
  fetchFinanceReports,
  lockPeriod,
  type OrphanCleanupResult,
} from '@/lib/finance-api';
import { ApiClientError } from '@/lib/api-client';

export function FinanceMaintenancePage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrphanCleanupResult | null>(null);

  // Period lock (book close)
  const [lockDate, setLockDate] = useState('');
  const [currentLock, setCurrentLock] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockMsg, setLockMsg] = useState<string | null>(null);
  const [lockErr, setLockErr] = useState<string | null>(null);

  useEffect(() => {
    fetchFinanceReports()
      .then((r) => setCurrentLock(r.booksLockedBefore ?? null))
      .catch(() => {});
  }, []);

  async function handleLock(date: string | null) {
    setLockBusy(true);
    setLockErr(null);
    setLockMsg(null);
    try {
      await lockPeriod(date);
      setCurrentLock(date);
      if (!date) setLockDate('');
      setLockMsg(
        date
          ? `Books closed through ${new Date(date).toLocaleDateString()}. Entries dated before this are now rejected.`
          : 'Period lock cleared — entries of any date are accepted again.',
      );
    } catch (err) {
      setLockErr(err instanceof Error ? err.message : 'Could not update the period lock.');
    } finally {
      setLockBusy(false);
    }
  }

  function openModal() {
    setReason('');
    setError(null);
    setModalOpen(true);
  }

  async function handleConfirm() {
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      setError('Please enter a reason of at least 5 characters.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await cleanupOrphanHandovers(trimmed);
      setResult(res);
      setModalOpen(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Cleanup failed.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        eyebrow="Settings · Finance"
        title="Finance maintenance"
        description="Admin-only tools for cleaning up legacy finance data and running one-off jobs."
      />

      {/* Orphan cleanup card */}
      <GlassCard variant="default" padded="lg">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--sos-status-warning-soft)',
                color: 'var(--sos-status-warning)',
              }}
            >
              <Wrench size={16} />
            </div>
            <div>
              <div className="sos-title" style={{ fontSize: 'var(--sos-text-base)' }}>
                Clean up orphan rows from rejected handovers
              </div>
              <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)' }}>
                Retroactively cancels Invoice + Payment rows left behind by old
                &ldquo;verify then reject&rdquo; flows.
              </div>
            </div>
          </div>

          <div
            className="sos-banner sos-banner--info"
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              fontSize: 12.5,
              lineHeight: 1.55,
            }}
          >
            <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>Safe — only touches unpaid orphans.</strong> The scan
              targets handovers in <code>REJECTED</code> status that still hold an
              Invoice or Payment reference. Only <code>Payment</code> rows in{' '}
              <code>PENDING</code> and <code>Invoice</code> rows in <code>DRAFT</code> /{' '}
              <code>SENT</code> are voided. Anything carrying real money (paid /
              partial) is left untouched. Every voided row gets the reason
              you provide appended to its notes, plus one audit-log entry and
              one lead-timeline event so the trail is self-explanatory months later.
            </div>
          </div>

          {result ? (
            <div
              className="sos-banner sos-banner--success"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                fontSize: 13,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={14} />
                <strong>Cleanup complete.</strong>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <SummaryTile label="Rejected handovers scanned" value={String(result.scannedHandovers)} />
                <SummaryTile label="Invoices voided" value={String(result.voidedInvoices)} tone="success" />
                <SummaryTile label="Payments voided" value={String(result.voidedPayments)} tone="success" />
                <SummaryTile label="Leads cleaned" value={String(result.affectedLeadIds.length)} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                Reason logged: <em>&ldquo;{result.reason}&rdquo;</em> ·{' '}
                {new Date(result.processedAt).toLocaleString()}
              </div>
            </div>
          ) : null}

          <div>
            <PrimaryButton
              onClick={openModal}
              iconLeft={<Wrench size={14} />}
              disabled={submitting}
            >
              {result ? 'Run cleanup again' : 'Run cleanup…'}
            </PrimaryButton>
          </div>
        </div>
      </GlassCard>

      {/* Period lock (book close) card */}
      <GlassCard variant="default" padded="lg">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--sos-status-info-soft)',
                color: 'var(--sos-status-info)',
              }}
            >
              <Lock size={16} />
            </div>
            <div>
              <div className="sos-title" style={{ fontSize: 'var(--sos-text-base)' }}>
                Accounting period lock (book close)
              </div>
              <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)' }}>
                Freeze a closed period — payments and invoices dated before this date are rejected.
              </div>
            </div>
          </div>

          <div
            className="sos-banner sos-banner--info"
            style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.55 }}
          >
            <CalendarClock size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              {currentLock ? (
                <>
                  Books are currently <strong>closed through {new Date(currentLock).toLocaleDateString()}</strong>.
                  Any payment or invoice effective-dated before then is blocked.
                </>
              ) : (
                <>No period is locked — entries of any date are accepted.</>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 210 }}>
              <FormInput
                label="Close books before"
                type="date"
                value={lockDate}
                onChange={(e) => setLockDate(e.target.value)}
                hint="entries before this date are locked"
              />
            </div>
            <PrimaryButton
              onClick={() => void handleLock(lockDate || null)}
              disabled={lockBusy || !lockDate}
              iconLeft={lockBusy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Lock size={14} />}
            >
              {lockBusy ? 'Saving…' : 'Lock period'}
            </PrimaryButton>
            {currentLock ? (
              <SecondaryButton onClick={() => void handleLock(null)} disabled={lockBusy}>
                Clear lock
              </SecondaryButton>
            ) : null}
          </div>

          {lockMsg ? (
            <div className="sos-banner sos-banner--success" style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
              <CheckCircle2 size={14} /> {lockMsg}
            </div>
          ) : null}
          {lockErr ? (
            <div className="sos-banner sos-banner--danger" style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
              <AlertTriangle size={14} /> {lockErr}
            </div>
          ) : null}
        </div>
      </GlassCard>

      {/* Confirmation modal */}
      <Modal
        open={modalOpen}
        onClose={() => (submitting ? undefined : setModalOpen(false))}
        title="Clean up orphan finance rows"
        width={560}
        footer={
          <>
            <GhostButton onClick={() => setModalOpen(false)} disabled={submitting}>
              Cancel
            </GhostButton>
            <PrimaryButton
              onClick={() => void handleConfirm()}
              disabled={submitting}
              iconLeft={
                submitting ? (
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Wrench size={14} />
                )
              }
            >
              {submitting ? 'Cleaning up…' : 'Void orphans'}
            </PrimaryButton>
          </>
        }
      >
        <div
          className="sos-text-secondary"
          style={{ fontSize: 'var(--sos-text-sm)', marginBottom: 14 }}
        >
          The reason you enter below is appended to every voided Invoice /
          Payment&apos;s notes, written to the audit log, and added as a timeline
          event on each affected lead. Make it informative — somebody reading
          this trail in six months should understand what happened.
        </div>

        <Field label="Reason for cleanup" required>
          <FormTextarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="e.g. Retroactive cleanup of orphan invoices created by pre-fix &ldquo;verify then reject&rdquo; flow. See ticket #245."
          />
        </Field>

        {error ? (
          <div
            className="sos-banner sos-banner--danger"
            style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'neutral';
}) {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-0)',
        border: '1px solid var(--sos-border-subtle)',
      }}
    >
      <div className="sos-eyebrow" style={{ marginBottom: 2, fontSize: 10 }}>
        {label}
      </div>
      {tone ? (
        <StatusBadge tone={tone} size="sm">{value}</StatusBadge>
      ) : (
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
          {value}
        </div>
      )}
    </div>
  );
}
