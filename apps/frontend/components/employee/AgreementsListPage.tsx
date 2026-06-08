'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { FileText } from 'lucide-react';
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

/** Sales view of their agreements (drafts to resume + status tracking). */
export function AgreementsListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AgreementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAgreements({ mine: true })
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Agreements"
        title="My agreements"
        description="Drafts you can resume and agreements in review. Start a new one from a lead’s profile."
      />

      <GlassCard variant="default" padded={false}>
        {loading ? (
          <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center' }}>Loading…</div>
        ) : error ? (
          <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error}</div>
        ) : rows.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 28, textAlign: 'center' }}>
            <FileText size={22} style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 8 }}>No agreements yet. Open a lead and click “Create Agreement”.</div>
          </div>
        ) : (
          <>
          {/* Mobile (<640px): stacked cards — the 7-col table would force
              horizontal scrolling on a phone. */}
          <div className="sm:hidden" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
            {rows.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => router.push(`/sales/agreements/${a.id}` as Route)}
                style={{
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 14,
                  borderRadius: 12,
                  border: '1px solid var(--sos-border-subtle)',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12.5, color: 'var(--sos-text-secondary)' }}>{a.agreementNumber}</span>
                  <StatusBadge tone={STATUS_TONE[a.status]} size="sm" dot>
                    {a.status.replace(/_/g, ' ').toLowerCase()}
                  </StatusBadge>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                  {a.lead ? `${a.lead.firstName} ${a.lead.lastName}`.trim() : '—'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12.5, color: 'var(--sos-text-faint)' }}>
                  <span>{a.categoryKey}</span>
                  <span style={{ fontFamily: 'monospace' }}>{a.lead?.referenceCode ?? '—'}</span>
                  <span style={{ color: 'var(--sos-text-secondary)' }}>{a.currency} {a.totalAmount}</span>
                  <span>Updated {new Date(a.updatedAt).toLocaleDateString('en-GB')}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Desktop (>=640px): the full table. */}
          <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  {['Number', 'Applicant', 'Ref', 'Category', 'Status', 'Net', 'Updated'].map((c) => (
                    <th key={c} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--sos-text-faint)', borderBottom: '1px solid var(--sos-border-subtle)', whiteSpace: 'nowrap' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => router.push(`/sales/agreements/${a.id}` as Route)}
                    style={{ borderBottom: '1px solid var(--sos-border-subtle)', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12.5, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>{a.agreementNumber}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--sos-text-primary)', whiteSpace: 'nowrap' }}>{a.lead ? `${a.lead.firstName} ${a.lead.lastName}`.trim() : '—'}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--sos-text-faint)', whiteSpace: 'nowrap' }}>{a.lead?.referenceCode ?? '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--sos-text-secondary)' }}>{a.categoryKey}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <StatusBadge tone={STATUS_TONE[a.status]} size="sm" dot>
                        {a.status.replace(/_/g, ' ').toLowerCase()}
                      </StatusBadge>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>{a.currency} {a.totalAmount}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--sos-text-faint)', whiteSpace: 'nowrap' }}>{new Date(a.updatedAt).toLocaleDateString('en-GB')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </GlassCard>
    </div>
  );
}
