'use client';

// Read-only agreement summary for a lead — metadata only.
//
// HARD RULE (see finance memory): sales must NEVER get the agreement PDF. This
// component ONLY calls GET /agreements?leadId= (which carries no contentHtml
// and no PDF key) and renders number / service / amount / status. It never
// touches the preview or pdf-url endpoints and offers no create/edit/delete.
// Built for the admin reassign context panel: the admin sees that money is (or
// isn't) on the table before moving a lead, without exposing the document.

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { StatusBadge, type BadgeTone } from '@/components/sales-v2/ui';
import { listAgreements, type AgreementStatus, type AgreementSummary } from '@/lib/agreements';

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

function statusLabel(s: AgreementStatus): string {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function LeadAgreementSummary({ leadId }: { leadId: string }) {
  const [rows, setRows] = useState<AgreementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAgreements({ leadId })
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load agreements');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (loading) {
    return <div className="sos-text-muted" style={{ fontSize: 13, padding: '18px 0', textAlign: 'center' }}>Loading agreements…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: '10px 14px', background: 'var(--sos-status-danger-soft)', color: 'var(--sos-status-danger)', borderRadius: 8, fontSize: 13 }}>
        {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 4px', color: 'var(--sos-text-muted)', fontSize: 13 }}>
        <FileText size={16} style={{ flexShrink: 0, opacity: 0.6 }} />
        <span>No service agreement on file for this lead.</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((a) => (
        <div
          key={a.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '11px 14px',
            border: '1px solid var(--sos-border-subtle)',
            borderRadius: 10,
            background: 'var(--sos-surface-2)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--sos-text-primary)' }}>
              {a.agreementNumber}
            </span>
            <span className="sos-text-muted" style={{ fontSize: 12 }}>
              {a.categoryKey} · {a.currency} {Number(a.totalAmount).toLocaleString()}
            </span>
          </div>
          <StatusBadge tone={STATUS_TONE[a.status] ?? 'neutral'} size="sm">
            {statusLabel(a.status)}
          </StatusBadge>
        </div>
      ))}
      <div className="sos-text-faint" style={{ fontSize: 11, marginTop: 2 }}>
        Agreement details are view-only here — the document itself stays in Finance.
      </div>
    </div>
  );
}
