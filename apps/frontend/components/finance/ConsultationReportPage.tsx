'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { GhostButton, GlassCard, PageHeader, StatusBadge } from '@/components/sales-v2/ui';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useFinanceSession } from '@/components/layout/FinanceShell';
import {
  listVisitorPayments,
  type VisitorPaymentList,
  type VisitorPaymentMethod,
  type VisitorPaymentStatus,
} from '@/lib/reception-api';

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString()}`;
}

/** ISO → PKT (+05:00) day + HH:mm. */
function fmtWhen(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  const t = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()} ${t}`;
}

const STATUS_META: Record<VisitorPaymentStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  VERIFIED: { label: 'Verified', tone: 'success' },
  PENDING_REVIEW: { label: 'Pending review', tone: 'warning' },
  AWAITING_PROOF: { label: 'Awaiting proof', tone: 'neutral' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

const METHOD_LABEL: Record<VisitorPaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
};

export function ConsultationReportPage() {
  const { user } = useFinanceSession();
  const canView = user.permissions.includes('finance.verify_payment');

  const [status, setStatus] = useState<'' | VisitorPaymentStatus>('');
  const [method, setMethod] = useState<'' | VisitorPaymentMethod>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<VisitorPaymentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    listVisitorPayments({
      ...(status ? { status } : {}),
      ...(method ? { method } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    })
      .then((r) => {
        if (mine === seq.current) setData(r);
      })
      .catch((e) => {
        if (mine === seq.current) setError(e instanceof Error ? e.message : 'Could not load consultation payments');
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [status, method, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) {
    return <PermissionDeniedState message="You need the finance.verify_payment permission to view the consultation report." />;
  }

  const rows = data?.rows ?? [];
  const byCurrency = Object.entries(data?.totals.byCurrency ?? {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Finance · Reception"
        title="Consultation report"
        description="Every consultation fee taken at the front desk — cash and bank transfer, verified and pending. Filter by date, method or status."
      />

      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      ) : null}

      {/* Totals — verified cash / bank + pending, per currency. */}
      {byCurrency.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {byCurrency.map(([ccy, t]) => (
            <GlassCard key={ccy} variant="default" padded="md" style={{ flex: '1 1 220px', minWidth: 200 }}>
              <div className="sos-text-faint" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{ccy} · verified</div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                <div>
                  <div className="sos-text-faint" style={{ fontSize: 11 }}>Cash</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{money(ccy, t.cash)}</div>
                </div>
                <div>
                  <div className="sos-text-faint" style={{ fontSize: 11 }}>Bank</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{money(ccy, t.bank)}</div>
                </div>
                <div>
                  <div className="sos-text-faint" style={{ fontSize: 11 }}>Pending</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-status-warning)' }}>{money(ccy, t.pending)}</div>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      ) : null}

      {/* Filters */}
      <GlassCard variant="default" padded="md">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="sos-text-faint" style={{ fontSize: 11.5, fontWeight: 600 }}>Status</span>
            <select className="sos-input" value={status} onChange={(e) => setStatus(e.target.value as '' | VisitorPaymentStatus)} style={{ width: 'auto' }}>
              <option value="">All</option>
              <option value="VERIFIED">Verified</option>
              <option value="PENDING_REVIEW">Pending review</option>
              <option value="AWAITING_PROOF">Awaiting proof</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="sos-text-faint" style={{ fontSize: 11.5, fontWeight: 600 }}>Method</span>
            <select className="sos-input" value={method} onChange={(e) => setMethod(e.target.value as '' | VisitorPaymentMethod)} style={{ width: 'auto' }}>
              <option value="">All</option>
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="sos-text-faint" style={{ fontSize: 11.5, fontWeight: 600 }}>From</span>
            <input type="date" className="sos-input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="sos-text-faint" style={{ fontSize: 11.5, fontWeight: 600 }}>To</span>
            <input type="date" className="sos-input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} />
          </label>
          <GhostButton iconLeft={<RefreshCw size={14} />} onClick={() => load()} style={{ marginLeft: 'auto' }}>Refresh</GhostButton>
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard variant="default" padded="lg">
        {loading && !data ? (
          <div className="sos-text-muted" style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading consultations…
          </div>
        ) : rows.length === 0 ? (
          <div className="sos-text-faint" style={{ fontSize: 13, padding: '26px 4px', textAlign: 'center' }}>
            No consultation payments match these filters.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--sos-text-faint)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '8px 10px' }}>Date</th>
                  <th style={{ padding: '8px 10px' }}>Customer</th>
                  <th style={{ padding: '8px 10px' }}>Method</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '8px 10px' }}>Status</th>
                  <th style={{ padding: '8px 10px' }}>Receipt #</th>
                  <th style={{ padding: '8px 10px' }}>Verified</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const sm = STATUS_META[r.status];
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--sos-border-subtle)' }}>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', color: 'var(--sos-text-secondary)' }}>{fmtWhen(r.createdAt)}</td>
                      <td style={{ padding: '9px 10px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--sos-text-primary)' }}>{r.name}</div>
                        {r.phone ? <div className="sos-text-faint" style={{ fontSize: 11.5 }}>{r.phone}</div> : null}
                      </td>
                      <td style={{ padding: '9px 10px', color: 'var(--sos-text-secondary)' }}>{METHOD_LABEL[r.method]}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--sos-text-primary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money(r.currency, r.amount)}</td>
                      <td style={{ padding: '9px 10px' }}>
                        <StatusBadge tone={sm.tone} size="sm" dot>{sm.label}</StatusBadge>
                        {r.status === 'REJECTED' && r.rejectedReason ? (
                          <div className="sos-text-faint" style={{ fontSize: 11, marginTop: 2 }}>{r.rejectedReason}</div>
                        ) : null}
                      </td>
                      <td style={{ padding: '9px 10px', color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>{r.receiptNumber ?? '—'}</td>
                      <td style={{ padding: '9px 10px', color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>{r.verifiedAt ? fmtWhen(r.verifiedAt) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
