'use client';

// Finance Reports — the Insight layer. Firm-wide revenue (collected),
// cost (expenses) and margin, plus the AR position (fees vs collected) and
// a revenue-by-service breakdown. All figures reconcile with the per-customer
// numbers because they read the same rows.

import { useEffect, useState, type CSSProperties } from 'react';
import { AlertTriangle, Coins, FileSignature, FileText, Hourglass, Landmark, Receipt as ReceiptIcon, RotateCcw, TrendingUp, Users, Wallet } from 'lucide-react';
import { GlassCard, MetricCard, PageHeader } from '@/components/sales-v2/ui';
import {
  fetchAgingReport,
  fetchCreditNotes,
  fetchFinanceReports,
  fetchTaxReport,
  type AgingReport,
  type ApiCreditNote,
  type FinanceReportsSummary,
  type TaxReport,
} from '@/lib/finance-api';

const money = (n: number, ccy: string) =>
  `${ccy} ${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const th: CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--sos-text-faint)', borderBottom: '1px solid var(--sos-border-subtle)', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '12px 14px', fontSize: 13, color: 'var(--sos-text-secondary)', borderBottom: '1px solid var(--sos-border-subtle)' };
const tdRight: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export function FinanceReportsPage() {
  const [data, setData] = useState<FinanceReportsSummary | null>(null);
  const [aging, setAging] = useState<AgingReport | null>(null);
  const [tax, setTax] = useState<TaxReport | null>(null);
  const [creditNotes, setCreditNotes] = useState<ApiCreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Summary is required; the supporting reports are best-effort so one
    // failing endpoint doesn't blank the whole page.
    fetchFinanceReports()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load report'))
      .finally(() => setLoading(false));
    fetchAgingReport().then(setAging).catch(() => {});
    fetchTaxReport().then(setTax).catch(() => {});
    fetchCreditNotes().then(setCreditNotes).catch(() => {});
  }, []);

  if (loading) return <div className="sos-text-muted" style={{ padding: 40, textAlign: 'center' }}>Loading report…</div>;
  if (!data) return <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error ?? 'Not found'}</div>;

  const { cash, receivables, pipeline, revenue, counts, byService, currency: ccy } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Finance · Insight"
        title="Reports"
        description="Revenue, cost and margin across every customer — the firm-wide picture."
      />

      {error ? <div className="sos-banner sos-banner--danger">{error}</div> : null}
      {data.mixedCurrency ? (
        <div className="sos-banner sos-banner--warning" style={{ fontSize: 13 }}>
          ⚠︎ Payments span more than one currency. These rolled-up totals mix currencies and are indicative only — read per-customer figures for accuracy.
        </div>
      ) : null}

      {/* Cash actuals — the whole book */}
      <div>
        <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Cash — actuals</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <MetricCard label="Collected" value={money(cash.collected, ccy)} tone="success" Icon={ReceiptIcon} />
          <MetricCard label="Spent on clients" value={money(cash.expenses, ccy)} tone={cash.expenses > 0 ? 'warning' : 'neutral'} Icon={Coins} />
          <MetricCard label="Margin" value={money(cash.margin, ccy)} tone={cash.margin >= 0 ? 'success' : 'danger'} Icon={TrendingUp} hint="collected − expenses" />
        </div>
      </div>

      {/* Receivables — SIGNED agreements only */}
      <div>
        <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Receivables — signed agreements</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <MetricCard label="Fees (signed)" value={money(receivables.fees, ccy)} tone="accent" Icon={Wallet} />
          <MetricCard label="Collected on signed" value={money(receivables.collected, ccy)} tone="success" Icon={ReceiptIcon} />
          <MetricCard label="Outstanding" value={money(receivables.outstanding, ccy)} tone={receivables.outstanding > 0 ? 'warning' : 'success'} Icon={AlertTriangle} />
        </div>
      </div>

      {/* Pipeline — agreements in progress, NOT money yet */}
      <div>
        <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Pipeline — not signed yet <span style={{ textTransform: 'none', fontWeight: 400 }}>(potential, not counted as revenue)</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <MetricCard label="Agreements in progress" value={String(pipeline.agreements)} tone="info" Icon={FileText} />
          <MetricCard label="Potential value" value={money(pipeline.value, ccy)} tone="neutral" Icon={Wallet} hint="if all get signed & paid" />
        </div>
      </div>

      {/* Collections — cash actually received (verified payments) */}
      <div>
        <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Collections (cash received)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <MetricCard label="This month" value={money(revenue.month, ccy)} tone="neutral" />
          <MetricCard label="Year to date" value={money(revenue.ytd, ccy)} tone="neutral" />
          <MetricCard label="All time" value={money(revenue.allTime, ccy)} tone="neutral" />
        </div>
      </div>

      {/* Revenue recognition (accrual) — earned vs deferred vs accrued */}
      {data.recognition ? (
        <div>
          <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Revenue recognition (accrual) <span style={{ textTransform: 'none', fontWeight: 400 }}>· earned when milestones are delivered</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
            <MetricCard label="Earned revenue" value={money(data.recognition.earned, ccy)} tone="success" Icon={TrendingUp} hint="delivered milestones" />
            <MetricCard label="Deferred (unearned)" value={money(data.recognition.deferred, ccy)} tone={data.recognition.deferred > 0 ? 'warning' : 'neutral'} Icon={Hourglass} hint="cash for work not yet delivered — a liability" />
            <MetricCard label="Accrued (unbilled)" value={money(data.recognition.accrued, ccy)} tone={data.recognition.accrued > 0 ? 'info' : 'neutral'} Icon={Wallet} hint="delivered but not yet collected" />
          </div>
        </div>
      ) : null}

      {/* Portfolio counts */}
      <div>
        <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Portfolio</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <MetricCard label="Paying customers" value={String(counts.payingCustomers)} tone="neutral" Icon={Users} hint="made a verified payment" />
          <MetricCard label="Signed agreements" value={String(counts.signed)} tone="neutral" Icon={FileSignature} />
          <MetricCard label="Receipts issued" value={String(counts.receipts)} tone="neutral" Icon={ReceiptIcon} />
        </div>
      </div>

      {/* Revenue by service */}
      <GlassCard variant="default" padded={false}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>Revenue by service</h3>
        </div>
        {byService.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>No verified revenue yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={th}>Service</th>
                  <th style={{ ...th, textAlign: 'right' }}>This month</th>
                  <th style={{ ...th, textAlign: 'right' }}>YTD</th>
                  <th style={{ ...th, textAlign: 'right' }}>All time</th>
                </tr>
              </thead>
              <tbody>
                {byService.map((s) => (
                  <tr key={s.service}>
                    <td style={{ ...td, color: 'var(--sos-text-primary)', fontWeight: 600 }}>{s.service}</td>
                    <td style={tdRight}>{money(s.month, ccy)}</td>
                    <td style={tdRight}>{money(s.ytd, ccy)}</td>
                    <td style={tdRight}>{money(s.allTime, ccy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* AR aging — outstanding invoices by how overdue they are */}
      <GlassCard variant="default" padded={false}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={15} style={{ color: 'var(--sos-text-faint)' }} />
          <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>Accounts receivable — aging</h3>
        </div>
        {!aging || aging.buckets.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>Nothing outstanding — every issued invoice is settled.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={th}>Currency</th>
                  <th style={{ ...th, textAlign: 'right' }}>Current</th>
                  <th style={{ ...th, textAlign: 'right' }}>1–30</th>
                  <th style={{ ...th, textAlign: 'right' }}>31–60</th>
                  <th style={{ ...th, textAlign: 'right' }}>61–90</th>
                  <th style={{ ...th, textAlign: 'right' }}>90+</th>
                  <th style={{ ...th, textAlign: 'right' }}>Total due</th>
                </tr>
              </thead>
              <tbody>
                {aging.buckets.map((b) => (
                  <tr key={b.currency}>
                    <td style={{ ...td, color: 'var(--sos-text-primary)', fontWeight: 600 }}>{b.currency}</td>
                    <td style={tdRight}>{money(b.current, b.currency)}</td>
                    <td style={tdRight}>{money(b.d1_30, b.currency)}</td>
                    <td style={tdRight}>{money(b.d31_60, b.currency)}</td>
                    <td style={tdRight}>{money(b.d61_90, b.currency)}</td>
                    <td style={{ ...tdRight, color: b.d90_plus > 0 ? 'var(--sos-danger)' : undefined }}>{money(b.d90_plus, b.currency)}</td>
                    <td style={{ ...tdRight, color: 'var(--sos-text-primary)', fontWeight: 600 }}>{money(b.total, b.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {aging.invoices.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720, borderTop: '4px solid var(--sos-bg-base)' }}>
                <thead>
                  <tr>
                    <th style={th}>Invoice</th>
                    <th style={th}>Customer</th>
                    <th style={{ ...th, textAlign: 'right' }}>Due date</th>
                    <th style={{ ...th, textAlign: 'right' }}>Days overdue</th>
                    <th style={{ ...th, textAlign: 'right' }}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {aging.invoices.slice(0, 25).map((r) => (
                    <tr key={r.invoiceId}>
                      <td style={{ ...td, color: 'var(--sos-text-primary)', fontWeight: 600 }}>{r.invoiceNumber}</td>
                      <td style={td}>{r.customer}</td>
                      <td style={tdRight}>{r.dueDate ? new Date(r.dueDate).toLocaleDateString() : '—'}</td>
                      <td style={{ ...tdRight, color: r.daysOverdue > 90 ? 'var(--sos-danger)' : r.daysOverdue > 0 ? 'var(--sos-warning)' : undefined }}>{r.daysOverdue > 0 ? `${r.daysOverdue}d` : 'current'}</td>
                      <td style={{ ...tdRight, color: 'var(--sos-text-primary)' }}>{money(r.outstanding, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        )}
      </GlassCard>

      {/* Tax (GST/HST) — output vs input = net payable */}
      <GlassCard variant="default" padded={false}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Landmark size={15} style={{ color: 'var(--sos-text-faint)' }} />
          <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>Tax (GST/HST)</h3>
        </div>
        {!tax || tax.byCurrency.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>No tax recorded. Set a tax rate in settings and capture input tax on expenses to track this.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={th}>Currency</th>
                  <th style={{ ...th, textAlign: 'right' }}>Output tax (collected)</th>
                  <th style={{ ...th, textAlign: 'right' }}>Input tax (ITC)</th>
                  <th style={{ ...th, textAlign: 'right' }}>Net payable</th>
                </tr>
              </thead>
              <tbody>
                {tax.byCurrency.map((t) => (
                  <tr key={t.currency}>
                    <td style={{ ...td, color: 'var(--sos-text-primary)', fontWeight: 600 }}>{t.currency}</td>
                    <td style={tdRight}>{money(t.outputTax, t.currency)}</td>
                    <td style={tdRight}>{money(t.inputTax, t.currency)}</td>
                    <td style={{ ...tdRight, color: 'var(--sos-text-primary)', fontWeight: 600 }}>{money(t.netPayable, t.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Credit notes — refund / correction contra-documents */}
      <GlassCard variant="default" padded={false}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <RotateCcw size={15} style={{ color: 'var(--sos-text-faint)' }} />
          <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>Credit notes</h3>
        </div>
        {creditNotes.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>No credit notes issued. Refunds generate one automatically.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
              <thead>
                <tr>
                  <th style={th}>Credit note</th>
                  <th style={th}>Customer</th>
                  <th style={th}>Against invoice</th>
                  <th style={th}>Reason</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                  <th style={{ ...th, textAlign: 'right' }}>Issued</th>
                </tr>
              </thead>
              <tbody>
                {creditNotes.map((c) => (
                  <tr key={c.id}>
                    <td style={{ ...td, color: 'var(--sos-text-primary)', fontWeight: 600 }}>{c.creditNoteNumber}</td>
                    <td style={td}>{c.customer}</td>
                    <td style={td}>{c.invoiceNumber ?? '—'}</td>
                    <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.reason ?? '—'}</td>
                    <td style={{ ...tdRight, color: 'var(--sos-danger)' }}>−{money(c.amount, c.currency)}</td>
                    <td style={tdRight}>{new Date(c.issuedAt).toLocaleDateString()}</td>
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
