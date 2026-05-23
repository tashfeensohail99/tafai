'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { FilePlus2, FileText } from 'lucide-react';
import {
  GlassCard,
  StatusBadge,
  ButtonLink,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  listAgreements,
  type AgreementStatus,
  type AgreementSummary,
} from '@/lib/agreements';

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

  useEffect(() => {
    listAgreements({ leadId })
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load agreements'))
      .finally(() => setLoading(false));
  }, [leadId]);

  return (
    <GlassCard variant="strong" padded="lg">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <div className="sos-eyebrow">Service agreement</div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--sos-text-primary)', marginTop: 4 }}>
            Agreements for this lead
          </h3>
        </div>
        <ButtonLink
          href={`/sales/agreements/new?leadId=${leadId}` as Route}
          variant="primary"
          size="sm"
          iconLeft={<FilePlus2 size={14} />}
        >
          Create Agreement
        </ButtonLink>
      </div>

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
          {rows.map((a) => (
            <Link
              key={a.id}
              href={`/sales/agreements/${a.id}` as Route}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)', fontFamily: 'monospace' }}>
                  {a.agreementNumber}
                </span>
                <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                  {a.categoryKey} · {a.currency} {a.totalAmount}
                </span>
              </div>
              <StatusBadge tone={STATUS_TONE[a.status]} size="sm" dot>
                {a.status.replace(/_/g, ' ').toLowerCase()}
              </StatusBadge>
            </Link>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
