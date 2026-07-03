'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Banknote, Clock, Landmark, Loader2, Wallet } from 'lucide-react';
import { GlassCard, MetricCard, PageHeader } from '@/components/sales-v2/ui';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useReceptionSession } from '@/components/layout/ReceptionShell';
import {
  listVisitorPayments,
  type VisitorPaymentList,
  type VisitorPaymentMethod,
  type VisitorPaymentStatus,
} from '@/lib/reception-api';
import { td, th, todayPkt } from './shared';

function daysAgo(n: number): string {
  const base = new Date(`${todayPkt()}T00:00:00Z`).getTime();
  return new Date(base - n * 86400000).toISOString().slice(0, 10);
}

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString()}`;
}

function fmtWhen(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  const t = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${t}`;
}

const STATUS_META: Record<VisitorPaymentStatus, { label: string; color: string }> = {
  AWAITING_PROOF: { label: 'Awaiting proof', color: 'var(--sos-status-neutral)' },
  PENDING_REVIEW: { label: 'Pending', color: 'var(--sos-status-warning)' },
  VERIFIED: { label: 'Verified', color: 'var(--sos-status-success)' },
  REJECTED: { label: 'Rejected', color: 'var(--sos-status-danger)' },
};

const STATUS_FILTERS: Array<{ label: string; value: VisitorPaymentStatus | '' }> = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'PENDING_REVIEW' },
  { label: 'Verified', value: 'VERIFIED' },
  { label: 'Rejected', value: 'REJECTED' },
];
const METHOD_FILTERS: Array<{ label: string; value: VisitorPaymentMethod | '' }> = [
  { label: 'All', value: '' },
  { label: 'Cash', value: 'CASH' },
  { label: 'Bank', value: 'BANK_TRANSFER' },
];

export function ReceptionPayments() {
  const { user } = useReceptionSession();
  const canView =
    user.permissions.includes('reception.view') || user.permissions.includes('reception.check_in');

  const [from, setFrom] = useState<string>(() => daysAgo(29));
  const [to, setTo] = useState<string>(() => todayPkt());
  const [status, setStatus] = useState<VisitorPaymentStatus | ''>('');
  const [methodF, setMethodF] = useState<VisitorPaymentMethod | ''>('');
  const [data, setData] = useState<VisitorPaymentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    listVisitorPayments({ from, to, status: status || undefined, method: methodF || undefined })
      .then((r) => {
        if (mine === seq.current) setData(r);
      })
      .catch((e) => {
        if (mine === seq.current) setError(e instanceof Error ? e.message : 'Could not load payments');
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [from, to, status, methodF]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  if (!canView) {
    return <PermissionDeniedState message="You need reception access to view the payment register." />;
  }

  const currencies = data ? Object.entries(data.totals.byCurrency) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Reception · Payments"
        title="Payment register"
        description="Consultation fees taken at the front desk — cash in, bank transfers, and transfers still pending finance verification."
      />

      {/* Totals per currency */}
      {currencies.length === 0 ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {currencies.map(([cur, t]) => (
            <div key={cur} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              <MetricCard label={`Cash in (${cur})`} value={money(cur, t.cash)} tone="success" Icon={Banknote} />
              <MetricCard label={`Bank in (${cur})`} value={money(cur, t.bank)} tone="info" Icon={Landmark} />
              <MetricCard label={`Pending (${cur})`} value={money(cur, t.pending)} tone="warning" Icon={Clock} />
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 14 }}>
          <FilterGroup label="Status" options={STATUS_FILTERS} value={status} onPick={(v) => setStatus(v as VisitorPaymentStatus | '')} />
          <FilterGroup label="Method" options={METHOD_FILTERS} value={methodF} onPick={(v) => setMethodF(v as VisitorPaymentMethod | '')} />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 'auto' }}>
            <span className="sos-text-faint" style={{ fontSize: 11, fontWeight: 600 }}>From</span>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="sos-input" style={{ width: 'auto' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="sos-text-faint" style={{ fontSize: 11, fontWeight: 600 }}>To</span>
            <input type="date" value={to} min={from} max={todayPkt()} onChange={(e) => setTo(e.target.value)} className="sos-input" style={{ width: 'auto' }} />
          </label>
        </div>
      </GlassCard>

      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      ) : null}

      <GlassCard variant="default" padded="lg">
        {loading && !data ? (
          <div className="sos-text-muted" style={{ padding: 30, textAlign: 'center' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading…
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="sos-text-faint" style={{ fontSize: 13, padding: '20px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wallet size={16} /> No consultation payments in this range.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Visitor</th>
                  <th style={th}>Method</th>
                  <th style={th}>Status</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                  <th style={th}>Reference</th>
                  <th style={th}>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtWhen(r.createdAt)}</td>
                    <td style={td}>
                      <div style={{ color: 'var(--sos-text-primary)', fontWeight: 600 }}>{r.name}</div>
                      {r.phone ? <div className="sos-text-faint" style={{ fontSize: 11.5 }}>{r.phone}</div> : null}
                    </td>
                    <td style={td}>{r.method === 'CASH' ? 'Cash' : 'Bank transfer'}</td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, color: STATUS_META[r.status].color }}>
                        <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_META[r.status].color }} />
                        {STATUS_META[r.status].label}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: 'var(--sos-text-primary)', whiteSpace: 'nowrap' }}>{money(r.currency, r.amount)}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{r.transactionRef ?? '—'}</td>
                    <td style={td}>{r.receiptNumber ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: Array<{ label: string; value: string }>;
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="sos-text-faint" style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => onPick(o.value)}
              className="sos-btn sos-btn--sm"
              style={{
                border: `1px solid ${active ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
                background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
                color: active ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)',
                fontWeight: 600,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
