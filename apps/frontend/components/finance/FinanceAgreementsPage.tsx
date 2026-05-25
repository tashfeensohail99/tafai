'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { FileText, Inbox } from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
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

const ACTIONABLE: AgreementStatus[] = ['SUBMITTED', 'FINANCE_REVIEW'];

/** Finance review queue: agreements awaiting approval + recent decisions. */
export function FinanceAgreementsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AgreementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAgreements()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const queue = useMemo(() => rows.filter((a) => ACTIONABLE.includes(a.status)), [rows]);
  const others = useMemo(() => rows.filter((a) => !ACTIONABLE.includes(a.status)), [rows]);

  const table = (list: AgreementSummary[], emptyNote: string) =>
    list.length === 0 ? (
      <div className="sos-text-muted" style={{ padding: 22, textAlign: 'center', fontSize: 13 }}>{emptyNote}</div>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr>
              {['Number', 'Applicant', 'Ref', 'Category', 'Status', 'Net', 'Submitted'].map((c) => (
                <th key={c} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--sos-text-faint)', borderBottom: '1px solid var(--sos-border-subtle)', whiteSpace: 'nowrap' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} onClick={() => router.push(`/finance/agreements/${a.id}` as Route)} style={{ borderBottom: '1px solid var(--sos-border-subtle)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12.5, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>{a.agreementNumber}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--sos-text-primary)', whiteSpace: 'nowrap' }}>{a.lead ? `${a.lead.firstName} ${a.lead.lastName}`.trim() : '—'}</td>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--sos-text-faint)', whiteSpace: 'nowrap' }}>{a.lead?.referenceCode ?? '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--sos-text-secondary)' }}>{a.categoryKey}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <StatusBadge tone={STATUS_TONE[a.status]} size="sm" dot>{a.status.replace(/_/g, ' ').toLowerCase()}</StatusBadge>
                    {a.financeNotes && (a.status === 'SUBMITTED' || a.status === 'FINANCE_REVIEW') ? (
                      <StatusBadge tone="warm" size="sm" dot={false}>Resubmitted</StatusBadge>
                    ) : null}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>{a.currency} {a.totalAmount}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--sos-text-faint)', whiteSpace: 'nowrap' }}>{a.submittedAt ? new Date(a.submittedAt).toLocaleDateString('en-GB') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Finance · Agreements"
        title="Agreement review"
        description="Agreements submitted by Sales. Approve to lock the payment plan and create the service contract + installment ledger."
      />

      {error ? <div className="sos-banner sos-banner--danger">{error}</div> : null}

      <GlassCard variant="default" padded={false}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Inbox size={16} className="sos-text-faint" />
          <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>
            Awaiting review {queue.length > 0 ? `(${queue.length})` : ''}
          </h2>
        </div>
        {loading ? <div className="sos-text-muted" style={{ padding: 22, textAlign: 'center' }}>Loading…</div> : table(queue, 'Nothing awaiting review.')}
      </GlassCard>

      <GlassCard variant="default" padded={false}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={16} className="sos-text-faint" />
          <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>All other agreements</h2>
        </div>
        {loading ? <div className="sos-text-muted" style={{ padding: 22, textAlign: 'center' }}>Loading…</div> : table(others, 'No agreements yet.')}
      </GlassCard>
    </div>
  );
}
