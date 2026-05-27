'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { Search, Users } from 'lucide-react';
import {
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { fetchFinanceCustomers, type FinanceCustomerRow } from '@/lib/finance-profile';
import { labelForServiceCode } from '@/lib/service-types';

const money = (n: number, ccy: string) =>
  `${ccy} ${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const label = (s: string) => s.replace(/_/g, ' ').toLowerCase();

function tone(status: string): BadgeTone {
  const s = status.toUpperCase();
  if (['SIGNED', 'APPROVED', 'PAID', 'ACTIVE', 'COMPLETED', 'CONVERTED'].includes(s)) return 'success';
  if (['SENT', 'SUBMITTED', 'FINANCE_REVIEW', 'IN_REVIEW', 'PARTIALLY_PAID'].includes(s)) return 'info';
  if (['CHANGES_REQUESTED', 'PENDING', 'DRAFT', 'OVERDUE'].includes(s)) return 'warning';
  if (['CANCELLED', 'REJECTED', 'LOST'].includes(s)) return 'danger';
  return 'neutral';
}

/** The single most-advanced state to show as the customer's "phase". */
function phaseOf(c: FinanceCustomerRow): { text: string; badgeTone: BadgeTone } {
  if (c.hasPendingPayment) return { text: 'Payment to verify', badgeTone: 'warning' };
  if (c.processingStage) return { text: `Processing · ${label(c.processingStage)}`, badgeTone: 'violet' };
  if (c.hasContract) return { text: c.contractStatus ? label(c.contractStatus) : 'Active', badgeTone: tone(c.contractStatus ?? 'ACTIVE') };
  if (c.agreementStatus) return { text: `Agreement · ${label(c.agreementStatus)}`, badgeTone: tone(c.agreementStatus) };
  return { text: label(c.status), badgeTone: tone(c.status) };
}

const th: CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--sos-text-faint)', borderBottom: '1px solid var(--sos-border-subtle)', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '12px 14px', fontSize: 13, color: 'var(--sos-text-secondary)', borderBottom: '1px solid var(--sos-border-subtle)' };
const tdRight: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export function FinanceCustomersPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<FinanceCustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      setRows(await fetchFinanceCustomers(q));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(search), 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [search, load]);

  const totals = useMemo(() => {
    const ccy = rows[0]?.currency ?? 'CAD';
    return {
      count: rows.length,
      outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
      paid: rows.reduce((s, r) => s + r.paid, 0),
      ccy,
    };
  }, [rows]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        eyebrow="Finance"
        title="Customers"
        description="Everyone in your finance pipeline — search a client and open their full profile."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        <MetricCard label="Customers" value={String(totals.count)} tone="accent" Icon={Users} />
        <MetricCard label="Collected" value={money(totals.paid, totals.ccy)} tone="success" />
        <MetricCard label="Outstanding" value={money(totals.outstanding, totals.ccy)} tone={totals.outstanding > 0 ? 'warning' : 'success'} />
      </div>

      {/* Search */}
      <div style={{ position: 'relative', maxWidth: 420 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--sos-text-faint)' }} />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, or reference…"
          aria-label="Search customers"
          style={{
            width: '100%', padding: '10px 12px 10px 34px', borderRadius: 'var(--sos-radius-md)',
            border: '1px solid var(--sos-border)', background: 'var(--sos-input-bg)',
            color: 'var(--sos-text-primary)', fontSize: 13.5,
          }}
        />
      </div>

      {error ? <div className="sos-banner sos-banner--danger">{error}</div> : null}

      <GlassCard variant="default" padded={false}>
        {loading ? (
          <div className="sos-text-muted" style={{ padding: 40, textAlign: 'center' }}>Loading customers…</div>
        ) : rows.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 40, textAlign: 'center', fontSize: 13 }}>
            {search ? 'No customers match your search.' : 'No customers in the finance pipeline yet. They appear here once an agreement, contract, or payment exists.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={th}>Customer</th>
                  <th style={th}>Service</th>
                  <th style={th}>Phase</th>
                  <th style={{ ...th, textAlign: 'right' }}>Fee</th>
                  <th style={{ ...th, textAlign: 'right' }}>Paid</th>
                  <th style={{ ...th, textAlign: 'right' }}>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const phase = phaseOf(c);
                  const name = `${c.firstName} ${c.lastName}`.trim() || '—';
                  return (
                    <tr
                      key={c.leadId}
                      onClick={() => router.push(`/finance/clients/${c.leadId}` as Route)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: 'var(--sos-text-primary)' }}>{name}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 11.5, color: 'var(--sos-text-faint)' }}>{c.referenceCode} · {c.phone}</div>
                      </td>
                      <td style={td}>
                        <div>{labelForServiceCode(c.serviceInterest)}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--sos-text-faint)' }}>{c.targetCountry ?? '—'}</div>
                      </td>
                      <td style={td}><StatusBadge tone={phase.badgeTone} size="sm" dot={false}>{phase.text}</StatusBadge></td>
                      <td style={tdRight}>{money(c.fee, c.currency)}</td>
                      <td style={tdRight}>{money(c.paid, c.currency)}</td>
                      <td style={{ ...tdRight, color: c.outstanding > 0 ? 'var(--sos-warning, #b45309)' : 'var(--sos-text-secondary)', fontWeight: c.outstanding > 0 ? 600 : 400 }}>{money(c.outstanding, c.currency)}</td>
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
