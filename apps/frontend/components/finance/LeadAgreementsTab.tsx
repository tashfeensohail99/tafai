'use client';

import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, FileText, Pencil, Trash2 } from 'lucide-react';
import {
  GlassCard,
  StatusBadge,
  PrimaryButton,
  GhostButton,
  ButtonLink,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  deleteAgreement,
  listAgreements,
  type AgreementStatus,
  type AgreementSummary,
} from '@/lib/agreements';
import { CreateAgreementModal } from './CreateAgreementModal';

const STATUS_TONE: Record<AgreementStatus, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  FINANCE_REVIEW: 'info',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'success',
  EDITED_PENDING_SALES: 'warning',
  SENT: 'info',
  SIGNED: 'success',
  CANCELLED: 'neutral',
};

/**
 * Lead-scoped service-agreement list + "Create Agreement" entry. Uses the
 * new agreement flow (Sales authoring → Finance approval), which needs only
 * Sales permissions — unlike the old service-contract upload that required
 * finance.view_all.
 */
export function LeadAgreementsTab({ leadId }: { leadId: string }) {
  const [rows, setRows] = useState<AgreementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    listAgreements({ leadId })
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load agreements'))
      .finally(() => setLoading(false));
  }, [leadId]);

  useEffect(() => { reload(); }, [reload]);

  const handleDelete = async (id: string, number: string) => {
    if (!window.confirm(`Delete agreement ${number}? This can’t be undone.`)) return;
    setDeletingId(id);
    setError(null);
    try {
      await deleteAgreement(id);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <GlassCard variant="strong" padded="lg">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <div className="sos-eyebrow">Service agreement</div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--sos-text-primary)', marginTop: 4 }}>
            Agreement for this lead
          </h3>
        </div>
        <PrimaryButton
          size="sm"
          iconLeft={<FilePlus2 size={14} />}
          onClick={() => setModalOpen(true)}
          disabled={rows.length > 0}
        >
          Create Agreement
        </PrimaryButton>
      </div>

      {rows.length > 0 ? (
        <div className="sos-text-faint" style={{ fontSize: 12, marginBottom: 10 }}>
          Only one agreement per lead. Delete the current one to start a different category.
        </div>
      ) : null}

      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ marginBottom: 12 }}>{error}</div>
      ) : null}

      {loading ? (
        <div style={{ padding: 22, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
          Loading agreements…
        </div>
      ) : rows.length === 0 ? (
        <div
          style={{
            padding: '22px 16px',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--sos-text-muted)',
            background: 'var(--sos-surface-1)',
            borderRadius: 'var(--sos-radius-sm)',
          }}
        >
          <FileText size={26} style={{ color: 'var(--sos-text-faint)', marginBottom: 6 }} />
          <div>No agreement yet. Click <strong>Create Agreement</strong> to draft one — bio auto-fills and you set the payment plan.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((a) => {
            const locked = ['APPROVED', 'SENT', 'SIGNED'].includes(a.status);
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  background: 'var(--sos-surface-1)',
                  borderRadius: 'var(--sos-radius-sm)',
                  border: '1px solid var(--sos-border-subtle)',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 150 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)', fontFamily: 'monospace' }}>
                    {a.agreementNumber}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                    {a.categoryKey} · {a.currency} {a.totalAmount}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <StatusBadge tone={STATUS_TONE[a.status]} size="sm" dot>
                    {a.status.replace(/_/g, ' ').toLowerCase()}
                  </StatusBadge>
                  <ButtonLink href={`/sales/agreements/${a.id}`} variant="secondary" size="sm" iconLeft={<Pencil size={13} />}>
                    {locked ? 'View' : 'Edit'}
                  </ButtonLink>
                  {!locked ? (
                    <GhostButton size="sm" onClick={() => void handleDelete(a.id, a.agreementNumber)} disabled={deletingId === a.id} aria-label="Delete agreement">
                      <Trash2 size={14} />
                    </GhostButton>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </GlassCard>
      <CreateAgreementModal
        open={modalOpen}
        leadId={leadId}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
