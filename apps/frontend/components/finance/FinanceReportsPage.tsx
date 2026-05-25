'use client';

// Finance Reports — the Insight layer. Firm-wide revenue (collected),
// cost (expenses) and margin, plus the AR position (fees vs collected) and
// a revenue-by-service breakdown. All figures reconcile with the per-customer
// numbers because they read the same rows.

import { useEffect, useState, type CSSProperties } from 'react';
import { AlertTriangle, Coins, FileSignature, Receipt as ReceiptIcon, TrendingUp, Users, Wallet } from 'lucide-react';
import { GlassCard, MetricCard, PageHeader } from '@/components/sales-v2/ui';
import { fetchFinanceReports, type FinanceReportsSummary } from '@/lib/finance-api';

const money = (n: number, ccy: string) =>
  `${ccy} ${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const th: CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--sos-text-faint)', borderBottom: '1px solid var(--sos-border-subtle)', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '12px 14px', fontSize: 13, color: 'var(--sos-text-secondary)', borderBottom: '1px solid var(--sos-border-subtle)' };
const tdRight: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export function FinanceReportsPage() {
  const [data, setData] = useState<FinanceReportsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFinanceReports()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load report'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="sos-text-muted" style={{ padding: 40, textAlign: 'center' }}>Loading report…</div>;
  if (!data) return <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error ?? 'Not found'}</div>;

  const { totals, revenue, counts, byService, currency: ccy } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Finance · Insight"
        title="Reports"
        description="Revenue, cost and margin across every customer — the firm-wide picture."
      />

      {error ? <div className="sos-banner sos-banner--danger">{error}</div> : null}

      {/* Money position */}
      <div>
        <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Money position</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <MetricCard label="Fees contracted" value={money(totals.fees, ccy)} tone="accent" Icon={Wallet} />
          <MetricCard label="Collected" value={money(totals.collected, ccy)} tone="success" Icon={ReceiptIcon} />
          <MetricCard label="Outstanding" value={money(totals.outstanding, ccy)} tone={totals.outstanding > 0 ? 'warning' : 'success'} Icon={AlertTriangle} />
          <MetricCard label="Spent on clients" value={money(totals.expenses, ccy)} tone={totals.expenses > 0 ? 'warning' : 'neutral'} Icon={Coins} />
          <MetricCard label="Margin (cash)" value={money(totals.marginCash, ccy)} tone={totals.marginCash >= 0 ? 'success' : 'danger'} Icon={TrendingUp} hint={`Projected ${money(totals.marginProjected, ccy)} once fully collected`} />
        </div>
      </div>

      {/* Revenue (verified payments) */}
      <div>
        <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Revenue (verified payments)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <MetricCard label="This month" value={money(revenue.month, ccy)} tone="neutral" />
          <MetricCard label="Year to date" value={money(revenue.ytd, ccy)} tone="neutral" />
          <MetricCard label="All time" value={money(revenue.allTime, ccy)} tone="neutral" />
        </div>
      </div>

      {/* Portfolio counts */}
      <div>
        <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Portfolio</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <MetricCard label="Customers" value={String(counts.customers)} tone="neutral" Icon={Users} />
          <MetricCard label="Active contracts" value={String(counts.contracts)} tone="neutral" Icon={FileSignature} />
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
    </div>
  );
}
