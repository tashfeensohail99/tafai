'use client';

// Finance tab on the case workspace — gives the processing team a clear view of
// the client's financials (agreed / paid / balance + invoice, payment and
// receipt ledger) without leaving the case. Data comes from the
// processing-scoped GET /processing/cases/:id/finance (aggregated by lead +
// client, so it covers manual clients too). All figures are in the CAD base.

import type { CSSProperties } from 'react';
import { Wallet, FileText, Receipt, Loader2, CheckCircle2 } from 'lucide-react';
import { GlassCard } from '@/components/sales-v2/ui';
import type { CaseFinanceSummary } from '@/lib/processing';

function money(n: number, ccy: string): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${ccy}`;
}
function fmtDate(d: string | null): string {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime())
    ? '—'
    : t.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

const sectionLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--sos-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 8,
};

function statusColor(status: string): string {
  const s = status.toUpperCase();
  if (s === 'PAID' || s === 'VERIFIED') return 'var(--sos-status-success)';
  if (s === 'PARTIALLY_PAID' || s === 'PARTIAL' || s === 'PENDING' || s === 'SENT') return 'var(--sos-status-warning)';
  if (s === 'VOID' || s === 'CANCELLED' || s === 'REFUNDED') return 'var(--sos-status-danger)';
  return 'var(--sos-text-muted)';
}

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--sos-surface-2)', color, whiteSpace: 'nowrap' }}>
      {text.replace(/_/g, ' ')}
    </span>
  );
}

export function FinanceTab({ finance, loading }: { finance: CaseFinanceSummary | null; loading: boolean }) {
  if (loading || !finance) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40, color: 'var(--sos-text-muted)', fontSize: 13 }}>
        <Loader2 size={15} className="sos-spin" /> Loading finance…
      </div>
    );
  }

  const f = finance;
  const hasAny = f.totalAgreed > 0 || f.invoices.length > 0 || f.payments.length > 0 || f.receipts.length > 0;

  if (!hasAny) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--sos-text-muted)', fontSize: 13.5, lineHeight: 1.6 }}>
          <Wallet size={28} style={{ color: 'var(--sos-text-muted)', marginBottom: 10 }} />
          <div style={{ fontWeight: 600, color: 'var(--sos-text-secondary)' }}>No financials recorded yet</div>
          <div style={{ marginTop: 4 }}>Invoices, payments and receipts for this client will appear here.</div>
        </div>
      </GlassCard>
    );
  }

  const kpis: Array<{ label: string; value: string; color: string }> = [
    { label: 'Total agreed', value: money(f.totalAgreed, f.currency), color: 'var(--sos-text-primary)' },
    { label: 'Paid', value: money(f.totalPaid, f.currency), color: 'var(--sos-status-success)' },
    { label: 'Balance', value: money(f.balance, f.currency), color: f.balance > 0 ? 'var(--sos-status-warning)' : 'var(--sos-status-success)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {kpis.map((k) => (
          <GlassCard key={k.label} variant="panel" padded="md">
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color, marginTop: 6 }}>{k.value}</div>
          </GlassCard>
        ))}
      </div>

      {f.contract ? (
        <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <CheckCircle2 size={13} style={{ color: 'var(--sos-status-success)' }} />
          Agreement <strong style={{ color: 'var(--sos-text-secondary)' }}>{f.contract.contractNumber}</strong> · {money(f.contract.totalAmount, f.contract.currency)} · {f.contract.status.replace(/_/g, ' ')}
        </div>
      ) : null}

      {/* Invoices */}
      {f.invoices.length > 0 ? (
        <GlassCard variant="panel" padded="md">
          <div style={sectionLabel}><FileText size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Invoices</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {f.invoices.map((inv) => (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderTop: '1px solid var(--sos-border-subtle)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{inv.invoiceNumber}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>{fmtDate(inv.createdAt)}{inv.dueDate ? ` · due ${fmtDate(inv.dueDate)}` : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{money(inv.paidAmount, inv.currency)} <span style={{ color: 'var(--sos-text-muted)', fontWeight: 400 }}>/ {money(inv.totalAmount, inv.currency)}</span></div>
                  </div>
                  <Chip text={inv.status} color={statusColor(inv.status)} />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}

      {/* Payments */}
      {f.payments.length > 0 ? (
        <GlassCard variant="panel" padded="md">
          <div style={sectionLabel}><Wallet size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Payments</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {f.payments.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderTop: '1px solid var(--sos-border-subtle)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                    {money(p.amount, p.currency)}
                    {p.currency !== 'CAD' ? <span style={{ fontSize: 11.5, color: 'var(--sos-text-muted)', fontWeight: 400 }}> (≈ {money(p.baseAmount, 'CAD')})</span> : null}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>{p.paymentMethod ?? 'Payment'}{p.transactionRef ? ` · ${p.transactionRef}` : ''} · {fmtDate(p.paidAt)}</div>
                </div>
                <Chip text={p.status} color={statusColor(p.status)} />
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}

      {/* Receipts */}
      {f.receipts.length > 0 ? (
        <GlassCard variant="panel" padded="md">
          <div style={sectionLabel}><Receipt size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Receipts</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {f.receipts.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderTop: '1px solid var(--sos-border-subtle)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)', textDecoration: r.voided ? 'line-through' : 'none' }}>{r.receiptNumber}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>{r.paymentMethod ?? 'Receipt'} · {fmtDate(r.issuedAt)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{money(r.amount, r.currency)}</span>
                  {r.voided ? <Chip text="VOID" color="var(--sos-status-danger)" /> : null}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}
